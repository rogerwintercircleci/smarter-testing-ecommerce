import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase } from '../support/database';
import { addMinutes, BASE_DATE, bulkInsert, cents, pick, seededRandom } from '../support/fixtures';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import {
  ProductRepository,
  SearchProductsOptions,
} from '../../../src/services/product-catalog/repositories/product.repository';
import { ProductService } from '../../../src/services/product-catalog/services/product.service';

/**
 * A catalog of 2,000 products is seeded once; every test here is read-only.
 * Expected results are computed in memory from the same fixture rows, so the
 * assertions check the SQL the repository builds, not hard-coded numbers.
 */
const CATALOG_SIZE = 2000;
const CATEGORIES = ['outdoor', 'kitchen', 'office', 'garden', 'audio', 'toys', 'apparel', 'bath'];
const ADJECTIVES = ['Compact', 'Deluxe', 'Rugged', 'Classic', 'Smart', 'Portable', 'Wireless', 'Organic'];
const NOUNS = ['Lantern', 'Kettle', 'Backpack', 'Speaker', 'Planter', 'Blender', 'Jacket', 'Towel', 'Desk Lamp'];
const MATERIALS = ['bamboo', 'stainless steel', 'recycled nylon', 'oak', 'silicone', 'cotton'];

interface FixtureProduct {
  name: string;
  description: string;
  sku: string;
  price: number;
  inventory: number;
  categoryId: string;
  status: ProductStatus;
  soldCount: number;
  createdAt: Date;
}

function buildCatalog(): FixtureProduct[] {
  const rand = seededRandom(20240101);
  return Array.from({ length: CATALOG_SIZE }, (_, i) => {
    const roll = rand();
    const status =
      roll < 0.8
        ? ProductStatus.ACTIVE
        : roll < 0.9
          ? ProductStatus.DRAFT
          : roll < 0.95
            ? ProductStatus.OUT_OF_STOCK
            : ProductStatus.DISCONTINUED;
    // (i * 7919) mod 2000 is a permutation of 0..1999, so every price is unique
    // and price ordering is total (no ties to make pagination ambiguous).
    const priceCents = 499 + ((i * 7919) % CATALOG_SIZE) * 25;
    return {
      name: `${pick(rand, ADJECTIVES)} ${pick(rand, NOUNS)} ${i}`,
      description: `Made from ${pick(rand, MATERIALS)} for everyday use.`,
      sku: `CAT-${String(i).padStart(5, '0')}`,
      price: priceCents / 100,
      inventory: Math.floor(rand() * 200),
      categoryId: pick(rand, CATEGORIES),
      status,
      soldCount: Math.floor(rand() * 5000),
      createdAt: addMinutes(BASE_DATE, i),
    };
  });
}

describe('Product search, filtering and pagination (real Postgres, 2,000 products)', () => {
  let ds: DataSource;
  let service: ProductService;
  let catalog: FixtureProduct[];
  let active: FixtureProduct[];

  beforeAll(async () => {
    ds = await createTestDatabase();
    service = new ProductService(new ProductRepository(ds.getRepository(Product)));
    catalog = buildCatalog();
    active = catalog.filter((p) => p.status === ProductStatus.ACTIVE);
    await bulkInsert(ds, Product, catalog);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  const matchesText = (p: FixtureProduct, q: string) =>
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.description.toLowerCase().includes(q.toLowerCase());

  const byCreatedDesc = (a: FixtureProduct, b: FixtureProduct) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  /** Walk every page and return the SKUs in the order the repository returned them. */
  async function collectAllPages(query: string, options: SearchProductsOptions) {
    const skus: string[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await service.searchProducts(query, { ...options, page });
      totalPages = result.totalPages;
      skus.push(...result.items.map((p) => p.sku));
      page += 1;
    } while (page <= totalPages);
    return skus;
  }

  it('returns only active products when no filters are given', async () => {
    const result = await service.searchProducts('', {});
    expect(result.total).toBe(active.length);
    expect(result.items).toHaveLength(20);
    expect(result.items.every((p) => p.status === ProductStatus.ACTIVE)).toBe(true);
  });

  it.each(['lantern', 'KETTLE', 'bamboo', 'stainless', 'Wireless Speaker'])(
    'matches %p case-insensitively against name or description',
    async (query) => {
      const expected = active.filter((p) => matchesText(p, query));
      expect(expected.length).toBeGreaterThan(0);

      const result = await service.searchProducts(query, { limit: 500 });

      expect(result.total).toBe(expected.length);
      expect(result.items.map((p) => p.sku).sort()).toEqual(expected.map((p) => p.sku).sort());
    }
  );

  it('applies inclusive price bounds', async () => {
    const minPrice = 100;
    const maxPrice = 150;
    const expected = active.filter((p) => p.price >= minPrice && p.price <= maxPrice);

    const result = await service.searchProducts('', { minPrice, maxPrice, limit: 1000 });

    expect(result.total).toBe(expected.length);
    for (const item of result.items) {
      expect(Number(item.price)).toBeGreaterThanOrEqual(minPrice);
      expect(Number(item.price)).toBeLessThanOrEqual(maxPrice);
    }

    const exact = active[0];
    const pinned = await service.searchProducts('', { minPrice: exact.price, maxPrice: exact.price });
    expect(pinned.items.map((p) => p.sku)).toEqual([exact.sku]);
  });

  it('combines text, category and price filters', async () => {
    const options = { categoryId: 'kitchen', minPrice: 50, maxPrice: 400, limit: 1000 };
    const expected = active.filter(
      (p) => matchesText(p, 'steel') && p.categoryId === 'kitchen' && p.price >= 50 && p.price <= 400
    );

    const result = await service.searchProducts('steel', options);

    expect(result.total).toBe(expected.length);
    expect(result.items.map((p) => p.sku).sort()).toEqual(expected.map((p) => p.sku).sort());
  });

  it('sorts newest first by default', async () => {
    const expected = [...active].sort(byCreatedDesc).slice(0, 20).map((p) => p.sku);
    const result = await service.searchProducts('', {});
    expect(result.items.map((p) => p.sku)).toEqual(expected);
  });

  it('pages through a category by ascending price with no gaps or duplicates', async () => {
    const expected = active
      .filter((p) => p.categoryId === 'outdoor')
      .sort((a, b) => cents(a.price) - cents(b.price))
      .map((p) => p.sku);

    const skus = await collectAllPages('', {
      categoryId: 'outdoor',
      sortBy: 'price',
      sortOrder: 'ASC',
      limit: 15,
    });

    expect(skus).toEqual(expected);
  });

  it('pages through the full active catalog newest-first', async () => {
    const expected = [...active].sort(byCreatedDesc).map((p) => p.sku);
    const skus = await collectAllPages('', { limit: 25 });
    expect(skus).toHaveLength(active.length);
    expect(skus).toEqual(expected);
  });

  it('reports page metadata and returns an empty page past the end', async () => {
    const limit = 40;
    const first = await service.searchProducts('', { limit, page: 1 });
    expect(first.totalPages).toBe(Math.ceil(active.length / limit));
    expect(first.page).toBe(1);
    expect(first.limit).toBe(limit);

    const beyond = await service.searchProducts('', { limit, page: first.totalPages + 1 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(active.length);

    const last = await service.searchProducts('', { limit, page: first.totalPages });
    expect(last.items).toHaveLength(active.length - limit * (first.totalPages - 1));
  });

  it('sorts by sold count descending', async () => {
    const result = await service.searchProducts('', { sortBy: 'soldCount', sortOrder: 'DESC', limit: 100 });
    const counts = result.items.map((p) => p.soldCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBe(Math.max(...active.map((p) => p.soldCount)));
  });

  it('returns nothing for a query that matches no active product', async () => {
    const result = await service.searchProducts('zzz-no-such-product', {});
    expect(result).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });
});
