import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { FakePaymentGateway, FakeShippingProvider } from '../support/fakes';
import { cents, orderRow } from '../support/fixtures';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../../src/services/order-processing/entities/order.entity';
import { RefundRequest } from '../../../src/services/order-processing/entities/refund.entity';
import { Inventory, InventoryReservation } from '../../../src/services/inventory/entities/inventory.entity';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { RefundRepository } from '../../../src/services/order-processing/repositories/refund.repository';
import { InventoryRepository } from '../../../src/services/inventory/repositories/inventory.repository';
import {
  RefundService,
  RefundStatus,
  ReturnReason,
  ReturnStatus,
} from '../../../src/services/order-processing/services/refund.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

const DAY = 24 * 60 * 60 * 1000;

describe('Refunds and returns (RefundService + repositories, real Postgres)', () => {
  let ds: DataSource;
  let orders: OrderRepository;
  let refunds: RefundRepository;
  let inventory: InventoryRepository;
  let gateway: FakePaymentGateway;
  let shipping: FakeShippingProvider;
  let service: RefundService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    orders = new OrderRepository(ds.getRepository(Order));
    refunds = new RefundRepository(ds.getRepository(RefundRequest));
    inventory = new InventoryRepository(ds.getRepository(Inventory), ds.getRepository(InventoryReservation));
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
    gateway = new FakePaymentGateway();
    shipping = new FakeShippingProvider();
    service = new RefundService(refunds, orders, inventory, gateway.asService(), shipping.asService());
  });

  /**
   * A paid order delivered `deliveredDaysAgo` days before now. The return
   * window check uses the real clock, so offsets are kept far from the
   * 30-day boundary.
   */
  async function deliveredOrder(orderNumber: string, deliveredDaysAgo = 5, userId = 'buyer-1'): Promise<Order> {
    return orders.createOrder(
      orderRow(
        orderNumber,
        userId,
        [
          { productId: 'sku-tent', quantity: 2, unitPrice: 199.99 },
          { productId: 'sku-stove', quantity: 1, unitPrice: 49.5 },
        ],
        {
          status: OrderStatus.DELIVERED,
          paymentStatus: PaymentStatus.PAID,
          deliveredAt: new Date(Date.now() - deliveredDaysAgo * DAY),
        }
      )
    );
  }

  it('creates a pending refund priced from the order lines', async () => {
    const order = await deliveredOrder('ORD-R-1');

    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.CHANGED_MIND,
      description: 'Too heavy',
      items: [
        { productId: 'sku-tent', quantity: 1 },
        { productId: 'sku-stove', quantity: 1 },
      ],
    });

    const stored = await refunds.findById(refund.id);
    expect(stored.status).toBe(RefundStatus.PENDING);
    expect(stored.userId).toBe('buyer-1');
    expect(cents(stored.refundAmount)).toBe(19999 + 4950);
    expect(stored.restockItems).toBe(true);
    expect(stored.items).toEqual([
      { productId: 'sku-tent', quantity: 1 },
      { productId: 'sku-stove', quantity: 1 },
    ]);
  });

  it('does not restock defective items and requires photos for them', async () => {
    const order = await deliveredOrder('ORD-R-2');
    const base = { orderId: order.id, items: [{ productId: 'sku-stove', quantity: 1 }] };

    await expect(service.createRefundRequest({ ...base, reason: ReturnReason.DEFECTIVE })).rejects.toThrow(
      'Photos are required for defective or damaged items'
    );
    await expect(service.createRefundRequest({ ...base, reason: ReturnReason.DAMAGED, photos: [] })).rejects.toThrow(
      BadRequestError
    );

    const refund = await service.createRefundRequest({
      ...base,
      reason: ReturnReason.DEFECTIVE,
      photos: ['https://img.example.test/broken.jpg'],
    });
    const stored = await refunds.findById(refund.id);
    expect(stored.restockItems).toBe(false);
    expect(stored.photos).toEqual(['https://img.example.test/broken.jpg']);
  });

  it('rejects refunds for unpaid orders, expired windows and invalid lines', async () => {
    const unpaid = await orders.createOrder(
      orderRow('ORD-R-UNPAID', 'buyer-1', [{ productId: 'sku-tent', quantity: 1, unitPrice: 199.99 }])
    );
    const stale = await deliveredOrder('ORD-R-STALE', 45);
    const fresh = await deliveredOrder('ORD-R-FRESH', 3);
    const line = (productId: string, quantity: number) => ({ productId, quantity });

    await expect(
      service.createRefundRequest({ orderId: unpaid.id, reason: ReturnReason.OTHER, items: [line('sku-tent', 1)] })
    ).rejects.toThrow('Order must be paid to request a refund');
    await expect(
      service.createRefundRequest({ orderId: stale.id, reason: ReturnReason.OTHER, items: [line('sku-tent', 1)] })
    ).rejects.toThrow('Return window of 30 days has expired');
    await expect(
      service.createRefundRequest({ orderId: fresh.id, reason: ReturnReason.OTHER, items: [line('sku-kayak', 1)] })
    ).rejects.toThrow('Product sku-kayak not found in order');
    await expect(
      service.createRefundRequest({ orderId: fresh.id, reason: ReturnReason.OTHER, items: [line('sku-tent', 3)] })
    ).rejects.toThrow('Refund quantity exceeds ordered quantity');
    await expect(
      service.createRefundRequest({
        orderId: '00000000-0000-4000-8000-000000000000',
        reason: ReturnReason.OTHER,
        items: [line('sku-tent', 1)],
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await refunds.count()).toBe(0);
  });

  it('reports eligibility and previews refund amounts without writing', async () => {
    const fresh = await deliveredOrder('ORD-R-ELIG', 10);
    const stale = await deliveredOrder('ORD-R-OLD', 60);

    await expect(service.checkEligibility(fresh.id)).resolves.toEqual({ eligible: true, issues: [] });
    await expect(service.checkEligibility(stale.id)).resolves.toEqual({
      eligible: false,
      issues: ['Return window of 30 days has expired'],
    });

    const preview = await service.calculateRefundAmount({
      orderId: fresh.id,
      items: [{ productId: 'sku-tent', quantity: 2 }],
    });
    expect(cents(preview.refundAmount)).toBe(39998);
    expect(preview.items[0]).toMatchObject({ productId: 'sku-tent', quantity: 2, unitPrice: 199.99 });
    expect(await refunds.count()).toBe(0);
  });

  it('approves, pays out and restocks a refund', async () => {
    const order = await deliveredOrder('ORD-R-PAY');
    await inventory.update('sku-tent', { quantity: 7 });
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.WRONG_ITEM,
      items: [{ productId: 'sku-tent', quantity: 2 }],
    });

    await service.approveRefund(refund.id, 'agent-7');
    expect((await refunds.findById(refund.id)).status).toBe(RefundStatus.APPROVED);

    const completed = await service.processRefund(refund.id);

    expect(completed.status).toBe(RefundStatus.COMPLETED);
    expect(completed.processedAt).toBeInstanceOf(Date);
    expect(gateway.refunds).toHaveLength(1);
    expect(gateway.refunds[0]).toMatchObject({ transactionId: `txn_${order.id}`, reason: 'wrong_item' });
    expect(cents(gateway.refunds[0].amount)).toBe(39998);
    expect((await inventory.findByProductId('sku-tent')).quantity).toBe(9);
  });

  it('creates an inventory record when restocking a product that had none', async () => {
    const order = await deliveredOrder('ORD-R-NEWINV');
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.CHANGED_MIND,
      items: [{ productId: 'sku-stove', quantity: 1 }],
    });
    await service.approveRefund(refund.id);
    await service.processRefund(refund.id);

    const record = await inventory.findByProductId('sku-stove');
    expect(record.quantity).toBe(1);
  });

  it('marks the refund failed and leaves stock alone when the gateway errors', async () => {
    const order = await deliveredOrder('ORD-R-FAIL');
    await inventory.update('sku-tent', { quantity: 4 });
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.CHANGED_MIND,
      items: [{ productId: 'sku-tent', quantity: 1 }],
    });
    await service.approveRefund(refund.id);
    gateway.failNext = true;

    await expect(service.processRefund(refund.id)).rejects.toThrow('Gateway timeout');

    expect((await refunds.findById(refund.id)).status).toBe(RefundStatus.FAILED);
    expect((await inventory.findByProductId('sku-tent')).quantity).toBe(4);
  });

  it('enforces the pending → approved → processed ordering', async () => {
    const order = await deliveredOrder('ORD-R-ORDER');
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.OTHER,
      items: [{ productId: 'sku-stove', quantity: 1 }],
    });

    await expect(service.processRefund(refund.id)).rejects.toThrow('Only approved refunds can be processed');
    await expect(service.generateReturnLabel(refund.id)).rejects.toThrow(
      'Refund must be approved to generate return label'
    );

    const rejected = await service.rejectRefund(refund.id, 'Outside policy');
    expect(rejected.status).toBe(RefundStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('Outside policy');

    await expect(service.approveRefund(refund.id)).rejects.toThrow('Only pending refunds can be approved');
    await expect(service.rejectRefund(refund.id, 'again')).rejects.toThrow('Only pending refunds can be rejected');
    expect(gateway.refunds).toHaveLength(0);
  });

  it('generates a return label and tracks the parcel back to the warehouse', async () => {
    const order = await deliveredOrder('ORD-R-LABEL');
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.NOT_AS_DESCRIBED,
      items: [{ productId: 'sku-tent', quantity: 1 }],
    });
    await service.approveRefund(refund.id);

    const label = await service.generateReturnLabel(refund.id);

    const stored = await refunds.findById(refund.id);
    expect(stored.returnTrackingNumber).toBe(label.trackingNumber);
    expect(stored.returnLabelUrl).toBe(label.labelUrl);
    expect(stored.returnStatus).toBe(ReturnStatus.LABEL_GENERATED);

    shipping.trackingStatus.set(label.trackingNumber!, 'in_transit');
    await expect(service.trackReturn(label.trackingNumber!)).resolves.toMatchObject({
      refundId: refund.id,
      returnStatus: ReturnStatus.IN_TRANSIT,
    });
    expect((await refunds.findById(refund.id)).returnStatus).toBe(ReturnStatus.IN_TRANSIT);

    shipping.trackingStatus.set(label.trackingNumber!, 'delivered');
    await service.trackReturn(label.trackingNumber!);
    expect((await refunds.findById(refund.id)).returnStatus).toBe(ReturnStatus.RECEIVED);

    await expect(service.trackReturn('RET-UNKNOWN')).rejects.toThrow('Return not found');
  });

  it('marks a return as received', async () => {
    const order = await deliveredOrder('ORD-R-RECV');
    const refund = await service.createRefundRequest({
      orderId: order.id,
      reason: ReturnReason.OTHER,
      items: [{ productId: 'sku-stove', quantity: 1 }],
    });
    const received = await service.markReturnAsReceived(refund.id);
    expect(received.returnStatus).toBe(ReturnStatus.RECEIVED);
  });

  it('lists refunds by customer and order and counts them by status', async () => {
    const created: string[] = [];
    for (let i = 0; i < 24; i++) {
      const order = await deliveredOrder(`ORD-R-LIST-${i}`, 2 + (i % 20), `buyer-${i % 4}`);
      const refund = await service.createRefundRequest({
        orderId: order.id,
        reason: ReturnReason.CHANGED_MIND,
        items: [{ productId: 'sku-stove', quantity: 1 }],
      });
      created.push(refund.id);
      if (i % 3 === 0) await service.approveRefund(refund.id);
      if (i % 3 === 1) await service.rejectRefund(refund.id, 'policy');
    }

    expect(await refunds.countByStatus(RefundStatus.PENDING)).toBe(8);
    expect(await refunds.countByStatus(RefundStatus.APPROVED)).toBe(8);
    expect(await refunds.countByStatus(RefundStatus.REJECTED)).toBe(8);
    expect(await refunds.findByStatus(RefundStatus.APPROVED)).toHaveLength(8);

    const forBuyer2 = await service.getUserRefunds('buyer-2');
    expect(forBuyer2).toHaveLength(6);
    expect(forBuyer2.every((r) => r.userId === 'buyer-2')).toBe(true);

    const first = await refunds.findById(created[0]);
    const forOrder = await service.getOrderRefunds(first.orderId);
    expect(forOrder.map((r) => r.id)).toEqual([created[0]]);
  });
});
