/**
 * TDD: Order Repository Tests
 *
 * Comprehensive tests for order repository operations
 */

import { Repository } from 'typeorm';
import { OrderRepository } from './order.repository';
import { Order, OrderStatus, PaymentStatus } from '../entities/order.entity';

const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  merge: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
  metadata: { name: 'Order' },
} as unknown as Repository<Order>;

describe('OrderRepository', () => {
  let orderRepository: OrderRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository = new OrderRepository(mockRepository);
  });

  describe('findByOrderNumber', () => {
    it('should find order by order number', async () => {
      const mockOrder = { id: '123', orderNumber: 'ORD-001' } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.findByOrderNumber('ORD-001');

      expect(result).toEqual(mockOrder);
    });

    it('should return null if not found', async () => {
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await orderRepository.findByOrderNumber('NON-EXISTENT');

      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all orders for user', async () => {
      const mockOrders = [
        { id: '1', userId: 'user-123' },
        { id: '2', userId: 'user-123' },
      ] as Order[];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockOrders);

      const result = await orderRepository.findByUserId('user-123');

      expect(result).toEqual(mockOrders);
    });

    it('should sort by creation date descending', async () => {
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      await orderRepository.findByUserId('user-123');

      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        })
      );
    });
  });

  describe('findByStatus', () => {
    it('should find orders by status', async () => {
      const mockOrders = [{ id: '1', status: OrderStatus.PENDING }] as Order[];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockOrders);

      const result = await orderRepository.findByStatus(OrderStatus.PENDING);

      expect(result).toEqual(mockOrders);
    });
  });

  describe('findPendingOrders', () => {
    it('should find all pending orders', async () => {
      const mockOrders = [{ status: OrderStatus.PENDING }] as Order[];
      (mockRepository.find as jest.Mock).mockResolvedValue(mockOrders);

      const result = await orderRepository.findPendingOrders();

      expect(result).toEqual(mockOrders);
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      const mockOrder = { id: '123', status: OrderStatus.CONFIRMED } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.updateStatus('123', OrderStatus.CONFIRMED);

      expect(result.status).toBe(OrderStatus.CONFIRMED);
    });
  });

  describe('updatePaymentStatus', () => {
    it('should update payment status', async () => {
      const mockOrder = { id: '123', paymentStatus: PaymentStatus.PAID } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.updatePaymentStatus('123', PaymentStatus.PAID);

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('should set paidAt timestamp when paid', async () => {
      const mockOrder = {
        id: '123',
        paymentStatus: PaymentStatus.PAID,
        paidAt: expect.any(Date),
      } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.updatePaymentStatus('123', PaymentStatus.PAID);

      expect(result.paidAt).toBeDefined();
    });
  });

  describe('findOrdersByDateRange', () => {
    it('should find orders within date range', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await orderRepository.findOrdersByDateRange(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      expect(mockBuilder.where).toHaveBeenCalled();
      expect(mockBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('getTotalRevenue', () => {
    it('should calculate total revenue', async () => {
      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '1000.00' }),
      };
      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await orderRepository.getTotalRevenue();

      expect(result).toBe(1000.00);
    });

    it('should filter by paid orders only', async () => {
      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '500.00' }),
      };
      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await orderRepository.getTotalRevenue();

      expect(mockBuilder.where).toHaveBeenCalledWith(
        'order.paymentStatus = :status',
        { status: PaymentStatus.PAID }
      );
    });
  });

  describe('getOrderStats', () => {
    it('should return order statistics', async () => {
      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { status: OrderStatus.PENDING, count: '5' },
          { status: OrderStatus.DELIVERED, count: '10' },
        ]),
      };
      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await orderRepository.getOrderStats();

      expect(result).toEqual([
        { status: OrderStatus.PENDING, count: 5 },
        { status: OrderStatus.DELIVERED, count: 10 },
      ]);
    });
  });

  describe('markAsShipped', () => {
    it('should mark order as shipped', async () => {
      const mockOrder = {
        id: '123',
        status: OrderStatus.SHIPPED,
        shippedAt: expect.any(Date),
        trackingNumber: 'TRACK123',
      } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.markAsShipped('123', 'TRACK123');

      expect(result.status).toBe(OrderStatus.SHIPPED);
      expect(result.trackingNumber).toBe('TRACK123');
    });
  });

  describe('markAsDelivered', () => {
    it('should mark order as delivered', async () => {
      const mockOrder = {
        id: '123',
        status: OrderStatus.DELIVERED,
        deliveredAt: expect.any(Date),
      } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.markAsDelivered('123');

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.deliveredAt).toBeDefined();
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order', async () => {
      const mockOrder = {
        id: '123',
        status: OrderStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      } as Order;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockOrder);
      (mockRepository.merge as jest.Mock).mockReturnValue(mockOrder);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockOrder);

      const result = await orderRepository.cancelOrder('123');

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(result.cancelledAt).toBeDefined();
    });
  });
});
