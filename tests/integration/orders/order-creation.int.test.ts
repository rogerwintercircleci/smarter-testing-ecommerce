import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { addDays, BASE_DATE, bulkInsert, cents, orderRow, testAddress } from '../support/fixtures';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../../src/services/order-processing/entities/order.entity';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { OrderService } from '../../../src/services/order-processing/services/order.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

describe('Order creation (OrderService + OrderRepository, real Postgres)', () => {
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

  const address = { street: '1 Main St', city: 'Boulder', state: 'CO', zip: '80301', country: 'US' };

  it('prices an order with 10% tax and flat shipping and persists it as pending', async () => {
    const created = await service.createOrder({
      userId: 'buyer-1',
      items: [
        { productId: 'p-1', quantity: 2, unitPrice: 24.5, productName: 'Mug', productSku: 'MUG-1' },
        { productId: 'p-2', quantity: 1, unitPrice: 12 },
      ],
      shippingAddress: address,
      notes: 'Leave at the door',
    });

    const stored = await orders.findById(created.id);
    expect(stored.status).toBe(OrderStatus.PENDING);
    expect(stored.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(cents(stored.subtotal)).toBe(6100);
    expect(cents(stored.taxAmount)).toBe(610);
    expect(cents(stored.shippingCost)).toBe(1000);
    expect(cents(stored.discountAmount)).toBe(0);
    expect(cents(stored.total)).toBe(7710);
    expect(stored.notes).toBe('Leave at the door');
    expect(stored.items).toEqual([
      expect.objectContaining({ productId: 'p-1', productName: 'Mug', productSku: 'MUG-1', quantity: 2, subtotal: 49 }),
      expect.objectContaining({ productId: 'p-2', productName: 'Product', productSku: '', quantity: 1, subtotal: 12 }),
    ]);
  });

  it('rounds tax to the cent', async () => {
    const created = await service.createOrder({
      userId: 'buyer-1',
      items: [{ productId: 'p-1', quantity: 3, unitPrice: 11.11 }],
      shippingAddress: address,
    });
    const stored = await orders.findById(created.id);
    expect(cents(stored.subtotal)).toBe(3333);
    expect(cents(stored.taxAmount)).toBe(333);
    expect(cents(stored.total)).toBe(3333 + 333 + 1000);
  });

  it('normalises zip to postalCode on shipping and billing addresses', async () => {
    const created = await service.createOrder({
      userId: 'buyer-1',
      items: [{ productId: 'p-1', quantity: 1, unitPrice: 5 }],
      shippingAddress: address,
      billingAddress: { ...address, street: '9 Billing Rd', zip: '80302' },
    });

    const stored = await orders.findById(created.id);
    expect(stored.shippingAddress.postalCode).toBe('80301');
    expect(stored.billingAddress).toMatchObject({ street: '9 Billing Rd', postalCode: '80302' });
  });

  it('omits the billing address when none is supplied', async () => {
    const created = await service.createOrder({
      userId: 'buyer-1',
      items: [{ productId: 'p-1', quantity: 1, unitPrice: 5 }],
      shippingAddress: { ...testAddress },
    });
    expect((await orders.findById(created.id)).billingAddress).toBeNull();
  });

  it.each([
    ['no items', []],
    ['a zero quantity', [{ productId: 'p', quantity: 0, unitPrice: 5 }]],
    ['a negative quantity', [{ productId: 'p', quantity: -2, unitPrice: 5 }]],
  ])('rejects an order with %s and writes nothing', async (_case, items) => {
    await expect(
      service.createOrder({ userId: 'buyer-1', items, shippingAddress: address })
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await orders.count()).toBe(0);
  });

  it('assigns a formatted order number that can be looked up', async () => {
    const created = await service.createOrder({
      userId: 'buyer-1',
      items: [{ productId: 'p-1', quantity: 1, unitPrice: 5 }],
      shippingAddress: address,
    });

    expect(created.orderNumber).toMatch(/^ORD-\d{4}-\d{13}-[0-9A-F]{8}$/);
    const found = await orders.findByOrderNumber(created.orderNumber);
    expect(found!.id).toBe(created.id);
    expect(await orders.findByOrderNumber('ORD-0000-0')).toBeNull();
  });

  it('assigns distinct order numbers to orders placed in the same millisecond', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2024-06-01T12:00:00.000Z'));
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const numbers = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const created = await service.createOrder({
        userId: 'buyer-1',
        items: [{ productId: 'p-1', quantity: 1, unitPrice: 5 }],
        shippingAddress: address,
      });
      numbers.add(created.orderNumber);
    }

    expect(numbers.size).toBe(25);
    expect(await orders.count()).toBe(25);
  });

  it('enforces order-number uniqueness at the database level', async () => {
    await orders.createOrder(orderRow('ORD-DUP-1', 'buyer-1', [{ productId: 'p', quantity: 1, unitPrice: 1 }]));
    await expect(
      orders.createOrder(orderRow('ORD-DUP-1', 'buyer-2', [{ productId: 'p', quantity: 1, unitPrice: 1 }]))
    ).rejects.toThrow(/duplicate key/);
  });

  it('returns a customer’s order history newest first, excluding other customers', async () => {
    const rows = Array.from({ length: 90 }, (_, i) =>
      orderRow(`ORD-HIST-${i}`, `buyer-${i % 3}`, [{ productId: 'p', quantity: 1 + (i % 4), unitPrice: 9.99 }], {
        createdAt: addDays(BASE_DATE, i),
      })
    );
    await bulkInsert(ds, Order, rows);

    const history = await service.getUserOrders('buyer-1');

    const expected = rows
      .filter((r) => r.userId === 'buyer-1')
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
      .map((r) => r.orderNumber);
    expect(history.map((o) => o.orderNumber)).toEqual(expected);
    expect(history).toHaveLength(30);
  });

  it('raises NotFoundError for an unknown order id', async () => {
    await expect(
      service.getOrderById('00000000-0000-4000-8000-000000000000')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
