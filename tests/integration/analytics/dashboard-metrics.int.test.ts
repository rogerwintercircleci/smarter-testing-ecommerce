import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase } from '../support/database';
import { addMinutes, bulkInsert, cents, orderRow, productRow, seededRandom } from '../support/fixtures';
import { User, UserRole, UserStatus } from '../../../src/services/user-management/entities/user.entity';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import { Order, OrderStatus, PaymentStatus } from '../../../src/services/order-processing/entities/order.entity';
import { UserRepository } from '../../../src/services/user-management/repositories/user.repository';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { OrderRepository } from '../../../src/services/order-processing/repositories/order.repository';
import { AnalyticsService } from '../../../src/services/analytics/services/analytics.service';

/**
 * A small store is seeded once: 300 customers, 500 products and 2,000 orders
 * placed by those customers for those products. All tests are read-only and
 * compare the analytics service against figures computed from the fixtures.
 */
const USER_COUNT = 300;
const PRODUCT_COUNT = 500;
const ORDER_COUNT = 2000;

describe('Analytics dashboard metrics (AnalyticsService + repositories, real Postgres)', () => {
  let ds: DataSource;
  let service: AnalyticsService;
  let userRows: Array<Partial<User>>;
  let productRows: Array<Partial<Product>>;
  let orderRows: Array<Partial<Order>>;

  beforeAll(async () => {
    ds = await createTestDatabase();
    service = new AnalyticsService(
      new OrderRepository(ds.getRepository(Order)),
      new ProductRepository(ds.getRepository(Product)),
      new UserRepository(ds.getRepository(User))
    );

    const rand = seededRandom(5150);
    // One real bcrypt hash shared by every seeded account; no test logs in.
    const passwordHash = await bcrypt.hash('Seeded!Passw0rd', 10);
    userRows = Array.from({ length: USER_COUNT }, (_, i) => {
      const roll = rand();
      return {
        email: `customer${i}@store.example`,
        password: passwordHash,
        firstName: 'Customer',
        lastName: String(i),
        role: i < 5 ? UserRole.ADMIN : UserRole.CUSTOMER,
        status: roll < 0.7 ? UserStatus.ACTIVE : roll < 0.9 ? UserStatus.PENDING : UserStatus.SUSPENDED,
      };
    });
    await bulkInsert(ds, User, userRows);
    const users = await ds.getRepository(User).find({ select: { id: true } });

    productRows = Array.from({ length: PRODUCT_COUNT }, (_, i) =>
      productRow(i, {
        price: (299 + Math.floor(rand() * 20000)) / 100,
        inventory: Math.floor(rand() * 60),
        status: rand() < 0.9 ? ProductStatus.ACTIVE : ProductStatus.DISCONTINUED,
        // (i * 211) mod 500 is a permutation: unique sold counts, deterministic ranking.
        soldCount: (i * 211) % PRODUCT_COUNT,
        rating: 1 + Math.floor(rand() * 5),
        reviewCount: Math.floor(rand() * 30),
      })
    );
    await bulkInsert(ds, Product, productRows);
    const products = await ds.getRepository(Product).find({ order: { sku: 'ASC' } });

    const start = new Date('2025-01-01T00:00:00.000Z');
    orderRows = Array.from({ length: ORDER_COUNT }, (_, i) => {
      const paid = rand() < 0.75;
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const product = products[Math.floor(rand() * products.length)];
        return {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: 1 + Math.floor(rand() * 3),
          unitPrice: Number(product.price),
        };
      });
      return orderRow(`ORD-2025-${String(i).padStart(6, '0')}`, users[Math.floor(rand() * users.length)].id, lines, {
        paymentStatus: paid ? PaymentStatus.PAID : PaymentStatus.PENDING,
        status: paid ? OrderStatus.DELIVERED : OrderStatus.PENDING,
        createdAt: addMinutes(start, i * 131),
      });
    });
    await bulkInsert(ds, Order, orderRows);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  const paidRevenueCents = () =>
    orderRows.filter((o) => o.paymentStatus === PaymentStatus.PAID).reduce((sum, o) => sum + cents(o.total!), 0);

  it('reports store-wide totals on the dashboard', async () => {
    const metrics = await service.getDashboardMetrics();

    expect(cents(metrics.totalRevenue)).toBe(paidRevenueCents());
    expect(metrics.totalOrders).toBe(ORDER_COUNT);
    expect(metrics.totalUsers).toBe(USER_COUNT);
    expect(metrics.totalProducts).toBe(PRODUCT_COUNT);
  });

  it('matches revenue from the dashboard and the revenue endpoint', async () => {
    const [revenue, metrics] = await Promise.all([service.getTotalRevenue(), service.getDashboardMetrics()]);
    expect(revenue).toBe(metrics.totalRevenue);
  });

  it('counts active users', async () => {
    const expected = userRows.filter((u) => u.status === UserStatus.ACTIVE).length;
    await expect(service.getActiveUserCount()).resolves.toBe(expected);
  });

  it('derives customer lifetime value from paid revenue per registered user', async () => {
    const expected = Math.round(paidRevenueCents() / 100 / USER_COUNT);
    await expect(service.getCustomerLifetimeValue()).resolves.toBe(expected);
  });

  it('lists the best-selling active products', async () => {
    const expected = productRows
      .filter((p) => p.status === ProductStatus.ACTIVE)
      .sort((a, b) => b.soldCount! - a.soldCount!)
      .slice(0, 10)
      .map((p) => p.sku);

    const top = await service.getTopSellingProducts();

    expect(top.map((p) => p.sku)).toEqual(expected);
  });

  it('alerts on low-stock active products', async () => {
    const expected = productRows
      .filter((p) => p.status === ProductStatus.ACTIVE && p.inventory! <= 5)
      .map((p) => p.sku)
      .sort();

    const low = await service.getLowStockAlert(5);

    expect(low.map((p) => p.sku).sort()).toEqual(expected);
  });

  it('only surfaces well-reviewed products as top rated', async () => {
    const top = await service.getTopRatedProducts(25);
    expect(top).toHaveLength(25);
    for (const p of top) {
      expect(p.status).toBe(ProductStatus.ACTIVE);
      expect(p.reviewCount).toBeGreaterThanOrEqual(5);
    }
    const ratings = top.map((p) => p.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it('exports a products report built from live queries', async () => {
    const report = await service.exportReport('products');

    expect(report.type).toBe('products');
    expect(report.data.totalProducts).toBe(PRODUCT_COUNT);
    expect((report.data.topSelling as Product[]).map((p) => p.sku)).toEqual(
      (await service.getTopSellingProducts(10)).map((p) => p.sku)
    );
    expect((report.data.lowStock as Product[]).length).toBe(
      productRows.filter((p) => p.status === ProductStatus.ACTIVE && p.inventory! <= 10).length
    );
  });

  it('exports a users report built from live queries', async () => {
    const report = await service.exportReport('users');

    expect(report.data.totalUsers).toBe(USER_COUNT);
    expect(report.data.activeUsers).toBe(userRows.filter((u) => u.status === UserStatus.ACTIVE).length);
    expect(report.data.customerLifetimeValue).toBe(Math.round(paidRevenueCents() / 100 / USER_COUNT));
  });

  it('exports a revenue report with order counts', async () => {
    const report = await service.exportReport('revenue');

    expect(cents(report.data.totalRevenue as number)).toBe(paidRevenueCents());
    expect(report.data.orderCount).toBe(ORDER_COUNT);
  });
});
