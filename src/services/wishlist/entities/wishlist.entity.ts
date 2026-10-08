import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { numericTransformer } from '@libs/database/numeric.transformer';

@Entity('wishlist_items')
export class WishlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  productId: string;

  @Column({ nullable: true })
  note: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  priceWhenAdded: number;

  @CreateDateColumn()
  createdAt: Date;
}
