/**
 * Deterministic fixture builders for the integration suite.
 *
 * Only entity classes are imported here (never repositories or services), so
 * test impact analysis attributes repository/service coverage to the test
 * files that actually exercise them.
 */
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import {
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
} from '../../../src/services/order-processing/entities/order.entity';

/** Fixed reference point so no test depends on the wall clock. */
export const BASE_DATE = new Date('2024-01-01T12:00:00.000Z');

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** Small seeded PRNG (mulberry32) so generated data is identical on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** Postgres decimals come back as strings; compare money in integer cents. */
export function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

/** Insert rows in chunks to stay well under Postgres' bind-parameter limit. */
export async function bulkInsert<T extends ObjectLiteral>(
  dataSource: DataSource,
  entity: EntityTarget<T>,
  rows: Array<Partial<T>>,
  chunkSize = 500
): Promise<void> {
  const repository = dataSource.getRepository(entity);
  for (let i = 0; i < rows.length; i += chunkSize) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repository.insert(rows.slice(i, i + chunkSize) as any);
  }
}

export const testAddress = {
  street: '100 Integration Way',
  city: 'Denver',
  state: 'CO',
  postalCode: '80202',
  country: 'US',
};

export function productRow(index: number, overrides: Partial<Product> = {}): Partial<Product> {
  return {
    name: `Product ${index}`,
    description: `Fixture product number ${index}`,
    sku: `SKU-${String(index).padStart(5, '0')}`,
    price: 10 + (index % 50),
    inventory: 100,
    status: ProductStatus.ACTIVE,
    createdAt: addMinutes(BASE_DATE, index),
    ...overrides,
  };
}

export interface OrderLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  productName?: string;
  productSku?: string;
}

export function orderItems(lines: OrderLine[]): OrderItem[] {
  return lines.map(
    (line) =>
      ({
        id: '',
        orderId: '',
        productId: line.productId,
        productName: line.productName ?? 'Fixture item',
        productSku: line.productSku ?? '',
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        subtotal: Math.round(line.unitPrice * line.quantity * 100) / 100,
      }) as OrderItem
  );
}

/**
 * Build an order row with internally consistent money fields
 * (10% tax, flat shipping, optional discount).
 */
export function orderRow(
  orderNumber: string,
  userId: string,
  lines: OrderLine[],
  overrides: Partial<Order> = {}
): Partial<Order> {
  const items = orderItems(lines);
  const subtotalCents = items.reduce((sum, item) => sum + cents(item.subtotal), 0);
  const taxCents = Math.round(subtotalCents * 0.1);
  const shippingCents = 1000;
  const discountCents = cents(overrides.discountAmount ?? 0);
  return {
    orderNumber,
    userId,
    items,
    shippingAddress: testAddress,
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    subtotal: subtotalCents / 100,
    taxAmount: taxCents / 100,
    shippingCost: shippingCents / 100,
    discountAmount: discountCents / 100,
    total: (subtotalCents + taxCents + shippingCents - discountCents) / 100,
    createdAt: BASE_DATE,
    ...overrides,
  };
}
