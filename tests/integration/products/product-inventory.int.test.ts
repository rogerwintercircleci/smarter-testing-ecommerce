import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { bulkInsert, productRow, seededRandom } from '../support/fixtures';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { ProductService } from '../../../src/services/product-catalog/services/product.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

describe('Product stock counters (ProductService + ProductRepository, real Postgres)', () => {
  let ds: DataSource;
  let products: ProductRepository;
  let service: ProductService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    products = new ProductRepository(ds.getRepository(Product));
    service = new ProductService(products);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  async function oneProduct(inventory: number): Promise<Product> {
    return products.createProduct(productRow(1, { inventory }));
  }

  it('reserves stock by decrementing inventory', async () => {
    const product = await oneProduct(10);
    const updated = await service.reserveInventory(product.id, 3);
    expect(updated.inventory).toBe(7);
    expect((await products.findById(product.id)).inventory).toBe(7);
  });

  it('refuses to oversell and leaves inventory unchanged', async () => {
    const product = await oneProduct(2);
    await expect(service.reserveInventory(product.id, 3)).rejects.toThrow(
      new BadRequestError('Insufficient inventory')
    );
    expect((await products.findById(product.id)).inventory).toBe(2);
  });

  it('validates quantities before touching the database', async () => {
    const product = await oneProduct(5);
    await expect(service.reserveInventory(product.id, 0)).rejects.toThrow('Quantity must be positive');
    await expect(service.restockInventory(product.id, -4)).rejects.toThrow('Quantity must be positive');
    await expect(service.updateInventory(product.id, -1)).rejects.toThrow('Inventory cannot be negative');
    expect((await products.findById(product.id)).inventory).toBe(5);
  });

  it('restocks and sets absolute inventory', async () => {
    const product = await oneProduct(5);
    await service.restockInventory(product.id, 20);
    expect((await products.findById(product.id)).inventory).toBe(25);
    await service.updateInventory(product.id, 3);
    expect((await products.findById(product.id)).inventory).toBe(3);
  });

  it('records a sale against both inventory and sold count', async () => {
    const product = await oneProduct(12);
    await service.recordSale(product.id, 5);
    const stored = await products.findById(product.id);
    expect(stored.inventory).toBe(7);
    expect(stored.soldCount).toBe(5);
  });

  it('raises NotFoundError for stock operations on unknown products', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(service.reserveInventory(missing, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.restockInventory(missing, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.recordSale(missing, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reconciles a day of sales and restocks against an independent ledger', async () => {
    const productCount = 40;
    await bulkInsert(
      ds,
      Product,
      Array.from({ length: productCount }, (_, i) => productRow(i, { inventory: 20 + (i % 7) * 5 }))
    );
    const stored = await products.findAll({ order: { sku: 'ASC' } });
    const ledger = new Map(stored.map((p) => [p.id, { inventory: p.inventory, sold: 0 }]));

    const rand = seededRandom(42);
    const expectedOutcomes: string[] = [];
    const actualOutcomes: string[] = [];
    for (let event = 0; event < 400; event++) {
      const product = stored[Math.floor(rand() * productCount)];
      const entry = ledger.get(product.id)!;
      if (rand() < 0.15) {
        const quantity = 1 + Math.floor(rand() * 10);
        await service.restockInventory(product.id, quantity);
        entry.inventory += quantity;
        continue;
      }
      const quantity = 1 + Math.floor(rand() * 4);
      const shouldReject = quantity > entry.inventory;
      const error = await service.recordSale(product.id, quantity).then(
        () => null,
        (e: unknown) => e
      );
      expectedOutcomes.push(shouldReject ? 'rejected' : 'sold');
      actualOutcomes.push(error instanceof BadRequestError ? 'rejected' : error ? String(error) : 'sold');
      if (!shouldReject) {
        entry.inventory -= quantity;
        entry.sold += quantity;
      }
    }

    expect(actualOutcomes).toEqual(expectedOutcomes);
    // The fixture is sized so some sales genuinely hit the stock limit.
    expect(expectedOutcomes).toContain('rejected');

    const after = await products.findAll();
    for (const product of after) {
      expect({ id: product.id, inventory: product.inventory, sold: product.soldCount }).toEqual({
        id: product.id,
        ...ledger.get(product.id)!,
      });
    }
  });

  it('lists active products at or below the low-stock threshold', async () => {
    const inventories = [0, 3, 5, 6, 10, 11, 50];
    await bulkInsert(ds, Product, [
      ...inventories.map((inventory, i) => productRow(i, { inventory })),
      productRow(100, { inventory: 1, status: ProductStatus.DRAFT }),
      productRow(101, { inventory: 2, status: ProductStatus.DISCONTINUED }),
    ]);

    const atFive = await service.getLowStockProducts(5);
    expect(atFive.map((p) => p.inventory).sort((a, b) => a - b)).toEqual([0, 3, 5]);

    const atDefault = await service.getLowStockProducts();
    expect(atDefault.map((p) => p.inventory).sort((a, b) => a - b)).toEqual([0, 3, 5, 6, 10]);
  });

  it('lists only active products whose compare-at price exceeds the price', async () => {
    await bulkInsert(ds, Product, [
      productRow(1, { price: 20, compareAtPrice: 25 }),
      productRow(2, { price: 20, compareAtPrice: 20 }),
      productRow(3, { price: 20 }),
      productRow(4, { price: 20, compareAtPrice: 30, status: ProductStatus.DRAFT }),
      productRow(5, { price: 9.99, compareAtPrice: 10 }),
    ]);

    const onSale = await service.getProductsOnSale();
    expect(onSale.map((p) => p.sku).sort()).toEqual(['SKU-00001', 'SKU-00005']);
  });
});
