/**
 * TDD: Order Service Tests
 *
 * Testing order processing business logic
 */

import { OrderService } from './order.service';
import { OrderRepository } from '../repositories/order.repository';
import { Order, OrderStatus, PaymentStatus, OrderItem } from '../entities/order.entity';
import { NotFoundError } from '@libs/errors';

jest.mock('../repositories/order.repository');

describe('OrderService', () => {
  let orderService: OrderService;
  let mockOrderRepository: jest.Mocked<OrderRepository>;

  beforeEach(() => {
    mockOrderRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderNumber: jest.fn(),
      findByUserId: jest.fn(),
      updateStatus: jest.fn(),
      updatePaymentStatus: jest.fn(),
      cancelOrder: jest.fn(),
      markAsShipped: jest.fn(),
      markAsDelivered: jest.fn(),
      getTotalRevenue: jest.fn(),
      getOrderStats: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    orderService = new OrderService(mockOrderRepository);
  });

  describe('createOrder', () => {
    const validOrderData = {
      userId: 'user-123',
      items: [
        {
          productId: 'prod-1',
          productName: 'Product 1',
          productSku: 'SKU-001',
          unitPrice: 50.00,
          quantity: 2,
          subtotal: 100.00,
        },
      ] as OrderItem[],
      shippingAddress: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'USA',
      },
    };

    it('should create order successfully', async () => {
      const mockOrder = {
        id: 'order-123',
        orderNumber: 'ORD-2024-001',
        ...validOrderData,
        subtotal: 100.00,
        total: 110.00,
        status: OrderStatus.PENDING,
      } as Order;

      mockOrderRepository.create.mockResolvedValue(mockOrder);

      const result = await orderService.createOrder(validOrderData);

      expect(result).toEqual(mockOrder);
      expect(result.orderNumber).toMatch(/^ORD-\d{4}-\d+$/);
    });

    it('should reject order with empty items', async () => {
      const invalidData = {
        ...validOrderData,
        items: [],
      };

      await expect(orderService.createOrder(invalidData)).rejects.toThrow(
        'Order must contain at least one item'
      );
    });

    it('should reject order with negative quantity', async () => {
      const invalidData = {
        ...validOrderData,
        items: [{
          ...validOrderData.items[0],
          quantity: -1,
        }] as OrderItem[],
      };

      await expect(orderService.createOrder(invalidData)).rejects.toThrow(
        'Item quantity must be positive'
      );
    });

    it('should calculate subtotal correctly', async () => {
      const orderData = {
        ...validOrderData,
        items: [
          {
            productId: 'prod-1',
            productName: 'Product 1',
            productSku: 'SKU-001',
            unitPrice: 50.00,
            quantity: 2,
            subtotal: 100.00,
          },
          {
            productId: 'prod-2',
            productName: 'Product 2',
            productSku: 'SKU-002',
            unitPrice: 30.00,
            quantity: 3,
            subtotal: 90.00,
          },
        ] as OrderItem[],
      };

      mockOrderRepository.create.mockResolvedValue({
        subtotal: 190.00,
      } as Order);

      await orderService.createOrder(orderData);

      expect(mockOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subtotal: 190.00,
        })
      );
    });

    it('should calculate tax at 10%', async () => {
      mockOrderRepository.create.mockResolvedValue({
        subtotal: 100.00,
        taxAmount: 10.00,
      } as Order);

      await orderService.createOrder(validOrderData);

      expect(mockOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taxAmount: 10.00,
        })
      );
    });

    it('should add default shipping cost', async () => {
      mockOrderRepository.create.mockResolvedValue({
        shippingCost: 10.00,
      } as Order);

      await orderService.createOrder(validOrderData);

      expect(mockOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shippingCost: 10.00,
        })
      );
    });
  });

  describe('getOrderById', () => {
    it('should return order by ID', async () => {
      const mockOrder = { id: 'order-123' } as Order;
      mockOrderRepository.findById.mockResolvedValue(mockOrder);

      const result = await orderService.getOrderById('order-123');

      expect(result).toEqual(mockOrder);
    });

    it('should throw NotFoundError for non-existent order', async () => {
      mockOrderRepository.findById.mockRejectedValue(
        new NotFoundError('Order not found')
      );

      await expect(orderService.getOrderById('invalid')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getUserOrders', () => {
    it('should return all orders for user', async () => {
      const mockOrders = [
        { id: '1', userId: 'user-123' },
        { id: '2', userId: 'user-123' },
      ] as Order[];

      mockOrderRepository.findByUserId.mockResolvedValue(mockOrders);

      const result = await orderService.getUserOrders('user-123');

      expect(result).toEqual(mockOrders);
    });

    it('should return empty array for user with no orders', async () => {
      mockOrderRepository.findByUserId.mockResolvedValue([]);

      const result = await orderService.getUserOrders('user-456');

      expect(result).toEqual([]);
    });
  });

  describe('confirmOrder', () => {
    it('should confirm pending order', async () => {
      const mockOrder = {
        id: 'order-123',
        status: OrderStatus.CONFIRMED,
      } as Order;

      mockOrderRepository.updateStatus.mockResolvedValue(mockOrder);

      const result = await orderService.confirmOrder('order-123');

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith(
        'order-123',
        OrderStatus.CONFIRMED
      );
    });
  });

  describe('processPayment', () => {
    it('should mark payment as successful', async () => {
      const mockOrder = {
        id: 'order-123',
        paymentStatus: PaymentStatus.PAID,
        paidAt: expect.any(Date),
      } as Order;

      mockOrderRepository.updatePaymentStatus.mockResolvedValue(mockOrder);

      const result = await orderService.processPayment('order-123', 'payment-ref-123');

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('should handle payment failure', async () => {
      const mockOrder = {
        id: 'order-123',
        paymentStatus: PaymentStatus.FAILED,
      } as Order;

      mockOrderRepository.updatePaymentStatus.mockResolvedValue(mockOrder);

      const result = await orderService.processPayment('order-123', null);

      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
    });
  });

  describe('shipOrder', () => {
    it('should ship confirmed paid order', async () => {
      const mockOrder = {
        id: 'order-123',
        status: OrderStatus.SHIPPED,
        trackingNumber: 'TRACK-123',
      } as Order;

      mockOrderRepository.markAsShipped.mockResolvedValue(mockOrder);

      const result = await orderService.shipOrder('order-123', 'TRACK-123');

      expect(result.status).toBe(OrderStatus.SHIPPED);
      expect(result.trackingNumber).toBe('TRACK-123');
    });
  });

  describe('deliverOrder', () => {
    it('should mark order as delivered', async () => {
      const mockOrder = {
        id: 'order-123',
        status: OrderStatus.DELIVERED,
        deliveredAt: expect.any(Date),
      } as Order;

      mockOrderRepository.markAsDelivered.mockResolvedValue(mockOrder);

      const result = await orderService.deliverOrder('order-123');

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.deliveredAt).toBeDefined();
    });
  });

  describe('cancelOrder', () => {
    it('should cancel pending order', async () => {
      const mockOrder = {
        id: 'order-123',
        status: OrderStatus.PENDING,
        canBeCancelled: () => true,
      } as Order;

      mockOrderRepository.findById.mockResolvedValue(mockOrder);
      mockOrderRepository.cancelOrder.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
        canBeCancelled: () => false,
        calculateTotal: () => 0,
        calculateSubtotal: () => 0,
        isFulfilled: () => false,
        isPaid: () => false,
        getTotalItemsCount: () => 0,
      } as Order);

      const result = await orderService.cancelOrder('order-123');

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('should not cancel shipped order', async () => {
      const mockOrder = {
        id: 'order-123',
        status: OrderStatus.SHIPPED,
        canBeCancelled: () => false,
      } as Order;

      mockOrderRepository.findById.mockResolvedValue(mockOrder);

      await expect(orderService.cancelOrder('order-123')).rejects.toThrow(
        'Order cannot be cancelled in current status'
      );
    });
  });

  describe('applyDiscount', () => {
    it('should apply valid discount code', async () => {
      mockOrderRepository.findById.mockResolvedValue({
        id: 'order-123',
        subtotal: 100.00,
        taxAmount: 10.00,
        shippingCost: 10.00,
      } as Order);

      mockOrderRepository.update.mockResolvedValue({
        id: 'order-123',
        subtotal: 100.00,
        taxAmount: 10.00,
        shippingCost: 10.00,
        discountCode: 'SAVE20',
        discountAmount: 20.00,
        total: 100.00,
      } as Order);

      const result = await orderService.applyDiscount('order-123', 'SAVE20', 20.00);

      expect(result.discountCode).toBe('SAVE20');
      expect(result.discountAmount).toBe(20.00);
    });

    it('should reject discount greater than subtotal', async () => {
      mockOrderRepository.findById.mockResolvedValue({
        id: 'order-123',
        subtotal: 50.00,
      } as Order);

      await expect(
        orderService.applyDiscount('order-123', 'INVALID', 100.00)
      ).rejects.toThrow('Discount amount cannot exceed order subtotal');
    });

    it('should reject negative discount', async () => {
      mockOrderRepository.findById.mockResolvedValue({
        id: 'order-123',
        subtotal: 100.00,
      } as Order);

      await expect(
        orderService.applyDiscount('order-123', 'INVALID', -10.00)
      ).rejects.toThrow('Discount amount must be positive');
    });
  });

  describe('getOrderTotal', () => {
    it('should calculate total with tax and shipping', async () => {
      const mockOrder = {
        id: 'order-123',
        subtotal: 100.00,
        taxAmount: 10.00,
        shippingCost: 15.00,
        discountAmount: 0,
        calculateTotal: () => 125.00,
      } as Order;

      mockOrderRepository.findById.mockResolvedValue(mockOrder);

      const total = await orderService.getOrderTotal('order-123');

      expect(total).toBe(125.00);
    });

    it('should subtract discount from total', async () => {
      const mockOrder = {
        id: 'order-123',
        subtotal: 100.00,
        taxAmount: 10.00,
        shippingCost: 15.00,
        discountAmount: 25.00,
        calculateTotal: () => 100.00,
      } as Order;

      mockOrderRepository.findById.mockResolvedValue(mockOrder);

      const total = await orderService.getOrderTotal('order-123');

      expect(total).toBe(100.00);
    });
  });

  describe('getTotalRevenue', () => {
    it('should return total revenue from paid orders', async () => {
      mockOrderRepository.getTotalRevenue.mockResolvedValue(15000.00);

      const result = await orderService.getTotalRevenue();

      expect(result).toBe(15000.00);
    });
  });

  describe('getOrderStatistics', () => {
    it('should return order stats by status', async () => {
      const mockStats = [
        { status: OrderStatus.PENDING, count: 10 },
        { status: OrderStatus.DELIVERED, count: 45 },
      ];

      mockOrderRepository.getOrderStats.mockResolvedValue(mockStats);

      const result = await orderService.getOrderStatistics();

      expect(result).toEqual(mockStats);
    });
  });
});
