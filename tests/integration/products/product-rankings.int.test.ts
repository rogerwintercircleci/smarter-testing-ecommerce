import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase } from '../support/database';
import { bulkInsert, productRow, seededRandom } from '../support/fixtures';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { ProductService } from '../../../src/services/product-catalog/services/product.service';
import { BadRequestError } from '../../../src/libs/errors';

const PRODUCT_COUNT = 600;

interface Ranked {
  sku: string;
  status: ProductStatus;
  soldCount: number;
  rating: number;
  reviewCount: number;
}

describe('Top-selling and top-rated rankings (real Postgres, 600 products)', () => {
  let ds: DataSource;
  let products: ProductRepository;
  let service: ProductService;
  let fixtures: Ranked[];

  beforeAll(async () => {
    ds = await createTestDatabase();
    products = new ProductRepository(ds.getRepository(Product));
    service = new ProductService(products);

    const rand = seededRandom(7);
    fixtures = Array.from({ length: PRODUCT_COUNT }, (_, i) => ({
      sku: `RANK-${String(i).padStart(4, '0')}`,
      status: rand() < 0.85 ? ProductStatus.ACTIVE : ProductStatus.DISCONTINUED,
      // (i * 389) mod 600 is a permutation, so sold counts never tie.
      soldCount: ((i * 389) % PRODUCT_COUNT) * 3,
      rating: 1 + Math.floor(rand() * 5),
      reviewCount: Math.floor(rand() * 40),
    }));
    await bulkInsert(
      ds,
      Product,
      fixtures.map((f, i) => productRow(i, f))
    );
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  const activeBySold = () =>
    fixtures.filter((f) => f.status === ProductStatus.ACTIVE).sort((a, b) => b.soldCount - a.soldCount);

  it('returns the ten best-selling active products in order', async () => {
    const top = await service.getTopSellingProducts();
    expect(top.map((p) => p.sku)).toEqual(activeBySold().slice(0, 10).map((f) => f.sku));
  });

  it('honours a custom limit and never includes inactive products', async () => {
    const top = await service.getTopSellingProducts(75);
    expect(top).toHaveLength(75);
    expect(top.every((p) => p.status === ProductStatus.ACTIVE)).toBe(true);
    expect(top.map((p) => p.sku)).toEqual(activeBySold().slice(0, 75).map((f) => f.sku));
  });

  it('ranks by rating and enforces the minimum review count', async () => {
    const eligible = fixtures.filter((f) => f.status === ProductStatus.ACTIVE && f.reviewCount >= 5);
    const topRating = Math.max(...eligible.map((f) => f.rating));
    const atTop = eligible.filter((f) => f.rating === topRating).map((f) => f.sku);

    const top = await service.getTopRatedProducts(10);

    expect(top).toHaveLength(10);
    for (const product of top) {
      expect(product.status).toBe(ProductStatus.ACTIVE);
      expect(product.reviewCount).toBeGreaterThanOrEqual(5);
    }
    const ratings = top.map((p) => p.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    // Ratings are whole numbers, so ties are expected; every pick must come from the top tier.
    expect(atTop.length).toBeGreaterThanOrEqual(10);
    expect(top.every((p) => atTop.includes(p.sku))).toBe(true);
  });

  it('returns every eligible product when the limit exceeds the pool', async () => {
    const eligible = fixtures.filter((f) => f.status === ProductStatus.ACTIVE && f.reviewCount >= 35);
    const top = await service.getTopRatedProducts(PRODUCT_COUNT, 35);
    expect(top.map((p) => p.sku).sort()).toEqual(eligible.map((f) => f.sku).sort());
  });

  it('moves a product up the best-seller list as sales are recorded', async () => {
    // Use a product with plenty of stock that is currently outside the top 10.
    const [tenth] = (await service.getTopSellingProducts(10)).slice(-1);
    const outsider = (await service.getTopSellingProducts(40)).slice(-1)[0];
    const gap = tenth.soldCount - outsider.soldCount + 1;

    await products.updateInventory(outsider.id, gap + 10);
    await service.recordSale(outsider.id, gap);

    const after = await service.getTopSellingProducts(10);
    expect(after.map((p) => p.id)).toContain(outsider.id);
    expect(after.map((p) => p.id)).not.toContain(tenth.id);

    // Put the fixture back so the other tests keep seeing the seeded ranking.
    await products.getRepository().update(outsider.id, {
      soldCount: outsider.soldCount,
      inventory: outsider.inventory,
    });
  });

  it('recomputes a product rating from new reviews', async () => {
    // A draft product never appears in the rankings, so it can't disturb the other tests.
    const product = await products.createProduct(
      productRow(9999, { sku: 'RANK-DRAFT', status: ProductStatus.DRAFT })
    );
    await products.updateRating(product.id, 4, 2);

    // (4 * 2 + 4 * 3) / 5 = 4
    const updated = await service.updateProductRating(product.id, 4, 3);
    expect(updated.rating).toBe(4);
    expect(updated.reviewCount).toBe(5);

    await expect(service.updateProductRating(product.id, 6, 1)).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.updateProductRating(product.id, 0, 1)).rejects.toBeInstanceOf(BadRequestError);

    await products.delete(product.id);
  });
});
