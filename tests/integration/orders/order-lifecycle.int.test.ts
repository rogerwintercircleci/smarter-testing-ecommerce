import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { addMinutes, BASE_DATE, bulkInsert, orderRow, seededRandom } from '../support/fixtures';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../../src/services/order-processing/entities/order.entity';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { OrderService } from '../../../src/services/order-processing/services/order.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

describe('Order status lifecycle (OrderService + OrderRepository, real Postgres)', () => {
  let ds: DataSource;
  let orders: OrderRepository;
  let service: OrderService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    orders = new OrderRepository(ds.getRepository(Order));
    service = new OrderService(orders);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  async function pendingOrder(orderNumber = 'ORD-LIFE-1'): Promise<Order> {
    return orders.createOrder(
      orderRow(orderNumber, 'buyer-1', [{ productId: 'p-1', quantity: 2, unitPrice: 30 }])
    );
  }

  it('moves an order from pending through delivery, stamping each step', async () => {
    const order = await pendingOrder();

    await service.confirmOrder(order.id);
    expect((await orders.findById(order.id)).status).toBe(OrderStatus.CONFIRMED);

    await service.processPayment(order.id, 'txn_abc123');
    const paid = await orders.findById(order.id);
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
    expect(paid.isPaid()).toBe(true);
    expect(paid.paidAt).toBeInstanceOf(Date);

    await service.shipOrder(order.id, '1Z999AA10123456784');
    const shipped = await orders.findById(order.id);
    expect(shipped.status).toBe(OrderStatus.SHIPPED);
    expect(shipped.trackingNumber).toBe('1Z999AA10123456784');
    expect(shipped.shippedAt).toBeInstanceOf(Date);

    await service.markAsDelivered(order.id);
    const delivered = await orders.findById(order.id);
    expect(delivered.status).toBe(OrderStatus.DELIVERED);
    expect(delivered.isFulfilled()).toBe(true);
    expect(delivered.deliveredAt!.getTime()).toBeGreaterThanOrEqual(shipped.shippedAt!.getTime());
  });

  it('accepts payment and shipping details as objects', async () => {
    const order = await pendingOrder();

    await service.processPayment(order.id, { transactionId: 'txn_obj', method: 'credit_card' });
    await service.shipOrder(order.id, { trackingNumber: 'TRACK-OBJ', carrier: 'UPS' });

    const stored = await orders.findById(order.id);
    expect(stored.paymentStatus).toBe(PaymentStatus.PAID);
    expect(stored.trackingNumber).toBe('TRACK-OBJ');
  });

  it('marks payment as failed when no reference is supplied', async () => {
    const order = await pendingOrder();
    await service.processPayment(order.id, null);
    const stored = await orders.findById(order.id);
    expect(stored.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(stored.paidAt).toBeNull();
  });

  it.each([OrderStatus.PENDING, OrderStatus.CONFIRMED])('cancels a %s order', async (status) => {
    const order = await pendingOrder();
    await orders.updateStatus(order.id, status);

    await service.cancelOrder(order.id, 'customer request');

    const stored = await orders.findById(order.id);
    expect(stored.status).toBe(OrderStatus.CANCELLED);
    expect(stored.cancelledAt).toBeInstanceOf(Date);
  });

  it.each([OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED])(
    'refuses to cancel a %s order and leaves it unchanged',
    async (status) => {
      const order = await pendingOrder();
      await orders.updateStatus(order.id, status);

      await expect(service.cancelOrder(order.id)).rejects.toThrow(
        new BadRequestError('Order cannot be cancelled in current status')
      );
      const stored = await orders.findById(order.id);
      expect(stored.status).toBe(status);
      expect(stored.cancelledAt).toBeNull();
    }
  );

  it('raises NotFoundError for transitions on unknown orders', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(service.confirmOrder(missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.shipOrder(missing, 'T')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.cancelOrder(missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.processPayment(missing, 'txn')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runs a fulfilment batch and reports matching status statistics', async () => {
    const batchSize = 250;
    await bulkInsert(
      ds,
      Order,
      Array.from({ length: batchSize }, (_, i) =>
        orderRow(`ORD-BATCH-${i}`, `buyer-${i % 25}`, [{ productId: `p-${i % 9}`, quantity: 1, unitPrice: 15 + (i % 5) }], {
          createdAt: addMinutes(BASE_DATE, i),
        })
      )
    );
    const batch = await orders.findAll({ order: { orderNumber: 'ASC' } });

    // Each order follows one of several realistic paths, chosen deterministically.
    const rand = seededRandom(99);
    const expectedStatus = new Map<OrderStatus, number>();
    const expectedPayment = new Map<PaymentStatus, number>();
    const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

    for (const order of batch) {
      const roll = rand();
      if (roll < 0.1) {
        bump(expectedStatus, OrderStatus.PENDING);
        bump(expectedPayment, PaymentStatus.PENDING);
        continue;
      }
      if (roll < 0.2) {
        await service.cancelOrder(order.id, 'changed mind');
        bump(expectedStatus, OrderStatus.CANCELLED);
        bump(expectedPayment, PaymentStatus.PENDING);
        continue;
      }
      await service.confirmOrder(order.id);
      if (roll < 0.3) {
        await service.processPayment(order.id, null);
        await service.cancelOrder(order.id, 'payment failed');
        bump(expectedStatus, OrderStatus.CANCELLED);
        bump(expectedPayment, PaymentStatus.FAILED);
        continue;
      }
      await service.processPayment(order.id, `txn_${order.orderNumber}`);
      bump(expectedPayment, PaymentStatus.PAID);
      if (roll < 0.45) {
        bump(expectedStatus, OrderStatus.CONFIRMED);
        continue;
      }
      await service.shipOrder(order.id, `TRK-${order.orderNumber}`);
      if (roll < 0.7) {
        bump(expectedStatus, OrderStatus.SHIPPED);
        continue;
      }
      await service.deliverOrder(order.id);
      bump(expectedStatus, OrderStatus.DELIVERED);
    }

    const stats = await service.getOrderStatistics();
    expect(Object.fromEntries(stats.map((s) => [s.status, s.count]))).toEqual(
      Object.fromEntries(expectedStatus)
    );
    expect(stats.reduce((sum, s) => sum + s.count, 0)).toBe(batchSize);

    expect(await orders.findPendingOrders()).toHaveLength(expectedStatus.get(OrderStatus.PENDING) ?? 0);
    expect(await orders.findPaidOrders()).toHaveLength(expectedPayment.get(PaymentStatus.PAID) ?? 0);
    expect(await orders.count({ paymentStatus: PaymentStatus.FAILED })).toBe(
      expectedPayment.get(PaymentStatus.FAILED) ?? 0
    );

    const shipped = await orders.findByStatus(OrderStatus.SHIPPED);
    expect(shipped.every((o) => o.trackingNumber === `TRK-${o.orderNumber}`)).toBe(true);
    const createdTimes = shipped.map((o) => o.createdAt.getTime());
    expect(createdTimes).toEqual([...createdTimes].sort((a, b) => b - a));
  });
});
