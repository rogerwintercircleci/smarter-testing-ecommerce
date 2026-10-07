/**
 * Real-database helpers for the integration suite.
 *
 * Each test file gets its own Postgres schema, so Jest workers (and
 * CircleCI parallel nodes sharing a database) never step on each other.
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../../../src/services/user-management/entities/user.entity';
import { Product } from '../../../src/services/product-catalog/entities/product.entity';
import { Review } from '../../../src/services/product-catalog/entities/review.entity';
import { Order, OrderItem } from '../../../src/services/order-processing/entities/order.entity';
import { RefundRequest } from '../../../src/services/order-processing/entities/refund.entity';
import { Inventory, InventoryReservation } from '../../../src/services/inventory/entities/inventory.entity';
import { Discount } from '../../../src/services/promotions/entities/discount.entity';
import { WishlistItem } from '../../../src/services/wishlist/entities/wishlist.entity';

export const entities = [
  User,
  Product,
  Review,
  Order,
  OrderItem,
  RefundRequest,
  Inventory,
  InventoryReservation,
  Discount,
  WishlistItem,
];

const connection = {
  type: 'postgres' as const,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'ecommerce_test_db',
};

/**
 * Create an isolated schema, sync every entity into it, and return a
 * connected DataSource. Call `dropTestDatabase` in afterAll.
 */
export async function createTestDatabase(): Promise<DataSource> {
  const schema = `it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const admin = new DataSource(connection);
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.destroy();

  const dataSource = new DataSource({
    ...connection,
    schema,
    entities,
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  return dataSource;
}

export async function dropTestDatabase(dataSource: DataSource): Promise<void> {
  const schema = (dataSource.options as { schema?: string }).schema;
  if (schema) {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await dataSource.destroy();
}

/** Remove all rows between tests while keeping the schema. */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas.map((m) => `"${m.schema}"."${m.tableName}"`);
  await dataSource.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
