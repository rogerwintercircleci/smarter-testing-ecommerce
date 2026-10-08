import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '@libs/database/numeric.transformer';

export enum RefundStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ReturnReason {
  CHANGED_MIND = 'changed_mind',
  DEFECTIVE = 'defective',
  WRONG_ITEM = 'wrong_item',
  NOT_AS_DESCRIBED = 'not_as_described',
  DAMAGED = 'damaged',
  OTHER = 'other',
}

export enum ReturnStatus {
  LABEL_GENERATED = 'label_generated',
  IN_TRANSIT = 'in_transit',
  RECEIVED = 'received',
  INSPECTED = 'inspected',
}

@Entity('refund_requests')
export class RefundRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  orderId: string;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: ReturnReason,
  })
  reason: ReturnReason;

  @Column({ nullable: true })
  description: string;

  @Column('jsonb')
  items: Array<{
    productId: string;
    quantity: number;
  }>;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: numericTransformer })
  refundAmount: number;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Column({ nullable: true })
  rejectionReason: string;

  @Column('jsonb', { nullable: true })
  photos: string[];

  @Column({ nullable: true })
  returnTrackingNumber: string;

  @Column({
    type: 'enum',
    enum: ReturnStatus,
    nullable: true,
  })
  returnStatus: ReturnStatus;

  @Column({ default: false })
  restockItems: boolean;

  @Column({ nullable: true })
  processedAt: Date;

  @Column({ nullable: true })
  returnLabelUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
