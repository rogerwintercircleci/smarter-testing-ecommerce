import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase } from '../support/database';
import { addMinutes, bulkInsert, cents, orderRow, pick, seededRandom } from '../support/fixtures';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../../src/services/order-processing/entities/order.entity';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { OrderService } from '../../../src/services/order-processing/services/order.service';

/**
 * A year of order history (3,000 orders across 120 customers in 2024) is
 * seeded once. Every test is read-only and checks the repository's SQL
 * aggregations against totals computed independently from the fixture rows.
 */
const ORDER_COUNT = 3000;
const YEAR_START = new Date('2024-01-01T00:00:00.000Z');
const YEAR_MINUTES = 366 * 24 * 60;

const STATUS_FOR_PAYMENT: Record<PaymentStatus, OrderStatus[]> = {
  [PaymentStatus.PAID]: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
  [PaymentStatus.PENDING]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
  [PaymentStatus.FAILED]: [OrderStatus.CANCELLED],
  [PaymentStatus.REFUNDED]: [OrderStatus.REFUNDED],
};

describe('Order revenue and reporting aggregations (real Postgres, 3,000 orders)', () => {
  let ds: DataSource;
  let orders: OrderRepository;
  let service: OrderService;
  let rows: Array<Partial<Order>>;

  beforeAll(async () => {
    ds = await createTestDatabase();
    orders = new OrderRepository(ds.getRepository(Order));
    service = new OrderService(orders);

    const rand = seededRandom(2024);
    rows = Array.from({ length: ORDER_COUNT }, (_, i) => {
      const roll = rand();
      const paymentStatus =
        roll < 0.72
          ? PaymentStatus.PAID
          : roll < 0.87
            ? PaymentStatus.PENDING
            : roll < 0.95
              ? PaymentStatus.FAILED
              : PaymentStatus.REFUNDED;
      const lineCount = 1 + Math.floor(rand() * 4);
      const lines = Array.from({ length: lineCount }, () => ({
        productId: `prod-${Math.floor(rand() * 300)}`,
        quantity: 1 + Math.floor(rand() * 5),
        unitPrice: (199 + Math.floor(rand() * 25000)) / 100,
      }));
      const discountAmount = rand() < 0.2 ? Math.floor(rand() * 2000) / 100 : 0;
      // Evenly spaced through the year with a unique timestamp per order.
      const createdAt = addMinutes(YEAR_START, Math.floor((i * YEAR_MINUTES) / ORDER_COUNT) + 7);
      return orderRow(`ORD-2024-${String(i).padStart(6, '0')}`, `customer-${Math.floor(rand() * 120)}`, lines, {
        paymentStatus,
        status: pick(rand, STATUS_FOR_PAYMENT[paymentStatus]),
        discountAmount,
        discountCode: discountAmount > 0 ? 'SPRING' : undefined,
        createdAt,
      });
    });
    await bulkInsert(ds, Order, rows);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  const sumCents = (subset: Array<Partial<Order>>) => subset.reduce((sum, o) => sum + cents(o.total!), 0);
  const inRange = (start: Date, end: Date) =>
    rows.filter((o) => o.createdAt! >= start && o.createdAt! <= end);

  it('sums revenue from paid orders only', async () => {
    const expected = sumCents(rows.filter((o) => o.paymentStatus === PaymentStatus.PAID));
    const revenue = await service.getTotalRevenue();
    expect(cents(revenue)).toBe(expected);
  });

  it('groups order counts by status', async () => {
    const expected: Record<string, number> = {};
    for (const o of rows) expected[o.status!] = (expected[o.status!] ?? 0) + 1;

    const stats = await service.getOrderStatistics();

    expect(Object.fromEntries(stats.map((s) => [s.status, s.count]))).toEqual(expected);
  });

  it('returns orders in a date range, inclusive of both bounds, newest first', async () => {
    const start = new Date('2024-04-01T00:00:00.000Z');
    const end = new Date('2024-06-30T23:59:59.999Z');
    const expected = inRange(start, end);

    const found = await orders.findOrdersByDateRange(start, end);

    expect(found).toHaveLength(expected.length);
    const times = found.map((o) => o.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(start.getTime());
    expect(Math.max(...times)).toBeLessThanOrEqual(end.getTime());
  });

  it('treats range bounds as inclusive to the millisecond', async () => {
    const target = rows[1234];
    const exact = await orders.findOrdersByDateRange(target.createdAt!, target.createdAt!);
    expect(exact.map((o) => o.orderNumber)).toEqual([target.orderNumber]);

    const justAfter = new Date(target.createdAt!.getTime() + 1);
    const nextMinute = new Date(target.createdAt!.getTime() + 59_000);
    expect(await orders.findOrdersByDateRange(justAfter, nextMinute)).toHaveLength(0);
  });

  it('partitions the year into months whose order counts and totals add up', async () => {
    let countSum = 0;
    let centsSum = 0;
    for (let month = 0; month < 12; month++) {
      const start = new Date(Date.UTC(2024, month, 1));
      const end = new Date(Date.UTC(2024, month + 1, 1) - 1);
      const monthly = await orders.findOrdersByDateRange(start, end);
      const expected = inRange(start, end);
      expect(monthly).toHaveLength(expected.length);
      expect(monthly.reduce((sum, o) => sum + cents(o.total), 0)).toBe(sumCents(expected));
      countSum += monthly.length;
      centsSum += monthly.reduce((sum, o) => sum + cents(o.total), 0);
    }
    expect(countSum).toBe(ORDER_COUNT);
    expect(centsSum).toBe(sumCents(rows));
  });

  it('finds large orders above a threshold, largest first', async () => {
    const threshold = 1500;
    const expected = rows.filter((o) => cents(o.total!) >= threshold * 100);

    const large = await orders.findLargeOrders(threshold);

    expect(large).toHaveLength(expected.length);
    const totals = large.map((o) => cents(o.total));
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(totals[0]).toBe(Math.max(...rows.map((o) => cents(o.total!))));
  });

  it('lists the most recent orders', async () => {
    const recent = await orders.findRecentOrders(15);
    expect(recent.map((o) => o.orderNumber)).toEqual(
      rows.slice(-15).reverse().map((o) => o.orderNumber)
    );
  });

  it('finds every discounted order', async () => {
    const discounted = await orders.findOrdersWithDiscounts();
    const expected = rows.filter((o) => cents(o.discountAmount!) > 0);
    expect(discounted).toHaveLength(expected.length);
    expect(discounted.every((o) => o.discountCode === 'SPRING')).toBe(true);
  });

  it('returns paid orders and per-customer history consistent with the fixture', async () => {
    const paid = await orders.findPaidOrders();
    expect(paid).toHaveLength(rows.filter((o) => o.paymentStatus === PaymentStatus.PAID).length);

    const customer = 'customer-17';
    const history = await orders.findByUserId(customer);
    expect(history.map((o) => o.orderNumber).sort()).toEqual(
      rows.filter((o) => o.userId === customer).map((o) => o.orderNumber!).sort()
    );
  });

  it('stores order items as JSON that round-trips intact', async () => {
    const sample = rows[2500];
    const stored = await orders.findByOrderNumber(sample.orderNumber!);
    expect(stored!.items).toEqual(sample.items);
    expect(stored!.getTotalItemsCount()).toBe(sample.items!.reduce((sum, i) => sum + i.quantity, 0));
  });
});
