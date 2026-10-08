/**
 * TDD Implementation: Order Service
 *
 * Business logic for order processing
 */

import { OrderRepository, OrderStats } from '../repositories/order.repository';
import { Order, OrderStatus, PaymentStatus, OrderItem } from '../entities/order.entity';
import { BadRequestError } from '@libs/errors';
import { randomUUID } from 'crypto';

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  unitPrice: number;
  productName?: string;
  productSku?: string;
}

export interface CreateOrderDto {
  userId: string;
  items: CreateOrderItemDto[];
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode?: string;
    zip?: string; // Alias for postalCode
    country: string;
  };
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    postalCode?: string;
    zip?: string; // Alias for postalCode
    country: string;
  };
  notes?: string;
}

export class OrderService {
  private readonly TAX_RATE = 0.10; // 10% tax
  private readonly DEFAULT_SHIPPING = 10.00;

  constructor(
    private orderRepository: OrderRepository,
    // @ts-expect-error - Reserved for future product validation implementation
    private _productRepository?: any,
    // @ts-expect-error - Reserved for future order notification implementation
    private _notificationService?: any
  ) {}

  /**
   * Create new order
   */
  async createOrder(data: CreateOrderDto): Promise<Order> {
    // Validate items
    if (!data.items || data.items.length === 0) {
      throw new BadRequestError('Order must contain at least one item');
    }

    // Validate quantities
    for (const item of data.items) {
      if (item.quantity <= 0) {
        throw new BadRequestError('Item quantity must be positive');
      }
    }

    // Transform DTO items to OrderItems and calculate totals
    const orderItems: OrderItem[] = data.items.map(item => ({
      id: '', // Will be set by database
      orderId: '', // Will be set by database
      productId: item.productId,
      productName: item.productName || 'Product',
      productSku: item.productSku || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
    } as OrderItem));

    const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = Math.round(subtotal * this.TAX_RATE * 100) / 100;
    const shippingCost = this.DEFAULT_SHIPPING;
    const total = subtotal + taxAmount + shippingCost;

    // Generate order number
    const orderNumber = this.generateOrderNumber();

    // Normalize addresses to use postalCode
    const shippingAddress = {
      ...data.shippingAddress,
      postalCode: data.shippingAddress.postalCode || data.shippingAddress.zip || '',
    };

    const billingAddress = data.billingAddress ? {
      ...data.billingAddress,
      postalCode: data.billingAddress.postalCode || data.billingAddress.zip || '',
    } : undefined;

    // Create order
    const orderData: Partial<Order> = {
      userId: data.userId,
      items: orderItems,
      shippingAddress,
      billingAddress,
      notes: data.notes,
      orderNumber,
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      subtotal,
      taxAmount,
      shippingCost,
      discountAmount: 0,
      total,
    };

    return this.orderRepository.create(orderData);
  }

  /**
   * Get order by ID
   */
  async getOrderById(orderId: string): Promise<Order> {
    return this.orderRepository.findById(orderId);
  }

  /**
   * Get all orders for a user
   */
  async getUserOrders(userId: string): Promise<Order[]> {
    return this.orderRepository.findByUserId(userId);
  }

  /**
   * Confirm order
   */
  async confirmOrder(orderId: string): Promise<Order> {
    return this.orderRepository.updateStatus(orderId, OrderStatus.CONFIRMED);
  }

  /**
   * Process payment
   */
  async processPayment(orderId: string, paymentDataOrReference: string | any | null): Promise<Order> {
    // Handle both string reference and payment data object
    let paymentReference: string | null = null;

    if (typeof paymentDataOrReference === 'string') {
      paymentReference = paymentDataOrReference;
    } else if (paymentDataOrReference && typeof paymentDataOrReference === 'object') {
      paymentReference = paymentDataOrReference.transactionId || paymentDataOrReference.method;
    }

    const status = paymentReference ? PaymentStatus.PAID : PaymentStatus.FAILED;
    return this.orderRepository.updatePaymentStatus(orderId, status);
  }

  /**
   * Ship order
   */
  async shipOrder(orderId: string, shippingDataOrTracking: string | any): Promise<Order> {
    // Handle both string tracking number and shipping data object
    let trackingNumber: string;

    if (typeof shippingDataOrTracking === 'string') {
      trackingNumber = shippingDataOrTracking;
    } else {
      trackingNumber = shippingDataOrTracking.trackingNumber;
    }

    return this.orderRepository.markAsShipped(orderId, trackingNumber);
  }

  /**
   * Mark order as delivered (alias for deliverOrder)
   */
  async markAsDelivered(orderId: string): Promise<Order> {
    return this.deliverOrder(orderId);
  }

  /**
   * Mark order as delivered
   */
  async deliverOrder(orderId: string): Promise<Order> {
    return this.orderRepository.markAsDelivered(orderId);
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);

    if (!order.canBeCancelled()) {
      throw new BadRequestError('Order cannot be cancelled in current status');
    }

    return this.orderRepository.cancelOrder(orderId, reason);
  }

  /**
   * Apply discount to order
   */
  async applyDiscount(
    orderId: string,
    discountCode: string,
    discountAmount: number
  ): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);

    if (discountAmount < 0) {
      throw new BadRequestError('Discount amount must be positive');
    }

    if (discountAmount > order.subtotal) {
      throw new BadRequestError('Discount amount cannot exceed order subtotal');
    }

    const updatedOrder = {
      ...order,
      discountCode,
      discountAmount,
      total: order.subtotal + order.taxAmount + order.shippingCost - discountAmount,
    };

    return this.orderRepository.update(orderId, updatedOrder);
  }

  /**
   * Get order total
   */
  async getOrderTotal(orderId: string): Promise<number> {
    const order = await this.orderRepository.findById(orderId);
    return order.calculateTotal();
  }

  /**
   * Get total revenue
   */
  async getTotalRevenue(): Promise<number> {
    return this.orderRepository.getTotalRevenue();
  }

  /**
   * Get order statistics
   */
  async getOrderStatistics(): Promise<OrderStats[]> {
    return this.orderRepository.getOrderStats();
  }

  /**
   * Generate unique order number
   */
  private generateOrderNumber(): string {
    const year = new Date().getFullYear();
    const timestamp = Date.now();
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    return `ORD-${year}-${timestamp}-${suffix}`;
  }
}
