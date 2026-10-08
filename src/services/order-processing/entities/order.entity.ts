import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '@libs/database/numeric.transformer';

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PaymentMethod {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
}

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  orderId!: string;

  @Column()
  productId!: string;

  @Column()
  productName!: string;

  @Column()
  productSku!: string;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformer })
  unitPrice!: number;

  @Column('int')
  quantity!: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformer })
  subtotal!: number;

  /**
   * Calculate subtotal
   */
  calculateSubtotal(): number {
    return this.unitPrice * this.quantity;
  }
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  userId!: string;

  @Column({ unique: true })
  @Index()
  orderNumber!: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  @Index()
  status!: OrderStatus;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    nullable: true,
  })
  paymentMethod?: PaymentMethod;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformer })
  subtotal!: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  taxAmount!: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  shippingCost!: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount!: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformer })
  total!: number;

  @Column({ nullable: true })
  discountCode?: string;

  @Column('jsonb')
  shippingAddress!: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  @Column('jsonb', { nullable: true })
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  @Column('jsonb')
  items!: OrderItem[];

  @Column('text', { nullable: true })
  notes?: string;

  @Column({ nullable: true })
  trackingNumber?: string;

  @Column({ type: 'timestamp', nullable: true })
  paidAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  shippedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Calculate total amount
   */
  calculateTotal(): number {
    return this.subtotal + this.taxAmount + this.shippingCost - this.discountAmount;
  }

  /**
   * Calculate subtotal from items
   */
  calculateSubtotal(): number {
    return this.items.reduce((sum, item) => sum + item.subtotal, 0);
  }

  /**
   * Check if order can be cancelled
   */
  canBeCancelled(): boolean {
    return [OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(this.status);
  }

  /**
   * Check if order is fulfilled
   */
  isFulfilled(): boolean {
    return this.status === OrderStatus.DELIVERED;
  }

  /**
   * Check if order is paid
   */
  isPaid(): boolean {
    return this.paymentStatus === PaymentStatus.PAID;
  }

  /**
   * Get total items count
   */
  getTotalItemsCount(): number {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }
}
