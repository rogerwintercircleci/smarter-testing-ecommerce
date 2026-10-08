import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '@libs/database/numeric.transformer';

@Entity('discounts')
export class Discount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  type: string;

  @Column('decimal', { transformer: numericTransformer })
  value: number;

  @Column()
  description: string;

  @Column({ nullable: true })
  expiresAt: Date;

  @Column({ nullable: true })
  startsAt: Date;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  minPurchaseAmount: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  maxDiscountAmount: number;

  @Column({ nullable: true })
  maxUsageCount: number;

  @Column({ nullable: true })
  maxUsagePerUser: number;

  @Column({ default: 0 })
  usageCount: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
