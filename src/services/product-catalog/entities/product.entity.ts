import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { numericTransformer } from '@libs/database/numeric.transformer';

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  OUT_OF_STOCK = 'out_of_stock',
  DISCONTINUED = 'discontinued',
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  name!: string;

  @Column('text')
  description!: string;

  @Column({ unique: true })
  @Index()
  sku!: string;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformer })
  price!: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  compareAtPrice?: number;

  @Column('int', { default: 0 })
  inventory!: number;

  @Column({ nullable: true })
  categoryId?: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.DRAFT,
  })
  status!: ProductStatus;

  @Column('simple-array', { nullable: true })
  images?: string[];

  @Column('jsonb', { nullable: true })
  metadata?: Record<string, unknown>;

  @Column('decimal', { precision: 3, scale: 2, default: 0, transformer: numericTransformer })
  @Index()
  rating!: number;

  @Column({ default: 0 })
  reviewCount!: number;

  @Column({ default: 0 })
  soldCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Check if product is in stock
   */
  isInStock(): boolean {
    return this.inventory > 0 && this.status === ProductStatus.ACTIVE;
  }

  /**
   * Check if product is on sale
   */
  isOnSale(): boolean {
    return !!this.compareAtPrice && this.compareAtPrice > this.price;
  }

  /**
   * Calculate discount percentage
   */
  getDiscountPercentage(): number {
    if (!this.compareAtPrice || this.compareAtPrice <= this.price) {
      return 0;
    }
    return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
  }
}
