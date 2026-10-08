import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { bulkInsert, cents, productRow, seededRandom } from '../support/fixtures';
import { Inventory, InventoryReservation } from '../../../src/services/inventory/entities/inventory.entity';
import { Product } from '../../../src/services/product-catalog/entities/product.entity';
import { InventoryRepository } from '../../../src/services/inventory/repositories/inventory.repository';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { InventoryService } from '../../../src/services/inventory/services/inventory.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

describe('Stock levels and adjustments (InventoryService + repositories, real Postgres)', () => {
  let ds: DataSource;
  let inventory: InventoryRepository;
  let products: ProductRepository;
  let service: InventoryService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    inventory = new InventoryRepository(ds.getRepository(Inventory), ds.getRepository(InventoryReservation));
    products = new ProductRepository(ds.getRepository(Product));
    service = new InventoryService(inventory, products);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  it('applies positive and negative adjustments', async () => {
    await service.adjustInventory({ productId: 'sku-1', quantity: 40, reason: 'receiving' });
    const after = await service.adjustInventory({ productId: 'sku-1', quantity: -15, reason: 'sale', userId: 'clerk' });
    expect(after.quantity).toBe(25);
    expect((await inventory.findByProductId('sku-1')).quantity).toBe(25);
  });

  it('refuses an adjustment that would take stock below zero', async () => {
    await inventory.update('sku-1', { quantity: 3 });
    await expect(
      service.adjustInventory({ productId: 'sku-1', quantity: -4, reason: 'sale' })
    ).rejects.toThrow(new BadRequestError('Insufficient inventory'));
    expect((await inventory.findByProductId('sku-1')).quantity).toBe(3);
  });

  it('applies a bulk stock import and reports rows that could not be applied', async () => {
    const skuCount = 400;
    const rand = seededRandom(8080);
    const expected = new Map<string, number>();
    for (let i = 0; i < skuCount; i++) {
      const quantity = Math.floor(rand() * 50);
      await inventory.update(`bulk-${i}`, { quantity });
      expected.set(`bulk-${i}`, quantity);
    }

    const updates = Array.from({ length: skuCount }, (_, i) => ({
      productId: `bulk-${i}`,
      quantity: Math.floor(rand() * 120) - 60,
    }));
    let expectedFailed = 0;
    for (const u of updates) {
      const next = expected.get(u.productId)! + u.quantity;
      if (next < 0) expectedFailed += 1;
      else expected.set(u.productId, next);
    }

    const result = await service.bulkUpdateInventory(updates);

    expect(result).toEqual({ updated: skuCount - expectedFailed, failed: expectedFailed });
    expect(expectedFailed).toBeGreaterThan(0);
    const stored = await inventory.findAll();
    expect(Object.fromEntries(stored.map((r) => [r.productId, r.quantity]))).toEqual(Object.fromEntries(expected));
  });

  it('flags products at or below their minimum stock level', async () => {
    const levels: Array<[string, number, number]> = [
      ['empty', 0, 10],
      ['at-min', 10, 10],
      ['half', 5, 10],
      ['healthy', 25, 10],
      ['no-min', 0, 0],
      ['quarter', 5, 20],
    ];
    for (const [productId, quantity, minStockLevel] of levels) {
      await inventory.update(productId, { quantity, minStockLevel });
    }

    const low = await service.getLowStockProducts();
    expect(low.map((r) => r.productId).sort()).toEqual(['at-min', 'empty', 'half', 'quarter']);

    const critical = await service.getLowStockProducts({ threshold: 50 });
    expect(Object.fromEntries(critical.map((r) => [r.productId, r.stockPercentage]))).toEqual({
      empty: 0,
      half: 50,
      quarter: 25,
    });
  });

  it('lists out-of-stock records regardless of minimum level', async () => {
    await inventory.update('a', { quantity: 0, minStockLevel: 5 });
    await inventory.update('b', { quantity: 0 });
    await inventory.update('c', { quantity: 1 });

    const out = await service.getOutOfStockProducts();
    expect(out.map((r) => r.productId).sort()).toEqual(['a', 'b']);
  });

  it('validates and stores minimum stock and reorder settings', async () => {
    await expect(service.setMinStockLevel('sku-1', -1)).rejects.toThrow(
      'Minimum stock level cannot be negative'
    );

    await service.setMinStockLevel('sku-1', 12);
    await service.setReorderPoint('sku-1', 15, 60);

    const stored = await inventory.findByProductId('sku-1');
    expect(stored).toMatchObject({ minStockLevel: 12, reorderPoint: 15, reorderQuantity: 60 });
  });

  it('values stock using the catalog price', async () => {
    await bulkInsert(ds, Product, [productRow(1, { price: 12.75 })]);
    const product = (await products.findBySku('SKU-00001'))!;
    await inventory.update(product.id, { quantity: 8 });

    const value = await service.getStockValue(product.id);

    expect(cents(value)).toBe(10200);
    await expect(service.getStockValue('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('keeps inventory records independent per product', async () => {
    for (let i = 0; i < 50; i++) {
      await service.adjustInventory({ productId: `iso-${i}`, quantity: i, reason: 'seed' });
    }
    await service.adjustInventory({ productId: 'iso-10', quantity: -10, reason: 'sale' });

    expect((await inventory.findByProductId('iso-10')).quantity).toBe(0);
    expect((await inventory.findByProductId('iso-11')).quantity).toBe(11);
    expect(await inventory.count()).toBe(50);
    expect((await service.getOutOfStockProducts()).map((r) => r.productId).sort()).toEqual(['iso-0', 'iso-10']);
  });
});
