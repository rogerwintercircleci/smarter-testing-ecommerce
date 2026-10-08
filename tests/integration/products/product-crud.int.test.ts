import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { bulkInsert, productRow } from '../support/fixtures';
import { Product, ProductStatus } from '../../../src/services/product-catalog/entities/product.entity';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { ProductService } from '../../../src/services/product-catalog/services/product.service';
import { BadRequestError, ConflictError, NotFoundError } from '../../../src/libs/errors';

describe('Product CRUD (ProductService + ProductRepository, real Postgres)', () => {
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

  const newProduct = {
    name: 'Trail Running Shoe',
    description: 'Lightweight shoe with a rock plate',
    sku: 'SHOE-TRAIL-001',
    price: 129.99,
    compareAtPrice: 159.99,
    inventory: 40,
    categoryId: 'footwear',
    images: ['front.jpg', 'side.jpg'],
    metadata: { weightGrams: 280, colors: ['black', 'teal'] },
  };

  it('creates a draft product and round-trips every column', async () => {
    const created = await service.createProduct(newProduct);

    const stored = await service.getProductById(created.id);
    expect(stored.status).toBe(ProductStatus.DRAFT);
    expect(stored.name).toBe('Trail Running Shoe');
    expect(Number(stored.price)).toBe(129.99);
    expect(Number(stored.compareAtPrice)).toBe(159.99);
    expect(stored.inventory).toBe(40);
    expect(stored.images).toEqual(['front.jpg', 'side.jpg']);
    expect(stored.metadata).toEqual({ weightGrams: 280, colors: ['black', 'teal'] });
    expect(stored.rating).toBe(0);
    expect(stored.soldCount).toBe(0);
  });

  it.each([
    ['non-positive price', { price: 0 }, 'Price must be positive'],
    ['negative inventory', { inventory: -1 }, 'Inventory cannot be negative'],
    ['compare-at below price', { compareAtPrice: 100 }, 'Compare at price must be higher than price'],
    ['compare-at equal to price', { compareAtPrice: 129.99 }, 'Compare at price must be higher than price'],
  ])('rejects %s without persisting anything', async (_case, override, message) => {
    await expect(service.createProduct({ ...newProduct, ...override })).rejects.toThrow(
      new BadRequestError(message)
    );
    expect(await products.count()).toBe(0);
  });

  it('enforces SKU uniqueness', async () => {
    await service.createProduct(newProduct);
    await expect(service.createProduct({ ...newProduct, name: 'Copycat' })).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(await products.count()).toBe(1);
  });

  it('treats SKU lookups as case-sensitive', async () => {
    await service.createProduct(newProduct);
    expect(await products.findBySku('SHOE-TRAIL-001')).not.toBeNull();
    expect(await products.findBySku('shoe-trail-001')).toBeNull();
    expect(await products.skuExists('SHOE-TRAIL-001')).toBe(true);
  });

  it('updates fields and validates price changes', async () => {
    const created = await service.createProduct(newProduct);

    const updated = await service.updateProduct(created.id, { name: 'Trail Shoe v2', price: 119.5 });
    expect(updated.name).toBe('Trail Shoe v2');
    expect(Number((await products.findById(created.id)).price)).toBe(119.5);

    await expect(service.updateProduct(created.id, { price: -5 })).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      service.updateProduct(created.id, { price: 50, compareAtPrice: 40 })
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(Number((await products.findById(created.id)).price)).toBe(119.5);
  });

  it('publishes and unpublishes', async () => {
    const created = await service.createProduct(newProduct);

    await service.publishProduct(created.id);
    expect((await products.findById(created.id)).status).toBe(ProductStatus.ACTIVE);

    await service.unpublishProduct(created.id);
    expect((await products.findById(created.id)).status).toBe(ProductStatus.DRAFT);
  });

  it('deletes a product and reports unknown ids as NotFound', async () => {
    const created = await service.createProduct(newProduct);

    await service.deleteProduct(created.id);

    await expect(service.getProductById(created.id)).rejects.toThrow(
      new NotFoundError(`Product with ID ${created.id} not found`)
    );
    await expect(service.deleteProduct(created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.updateProduct(created.id, { name: 'ghost' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('loads exactly the requested ids in one query', async () => {
    await bulkInsert(ds, Product, Array.from({ length: 200 }, (_, i) => productRow(i)));
    const all = await products.findAll({ order: { sku: 'ASC' } });
    const wanted = all.filter((_, i) => i % 8 === 3).map((p) => p.id);

    const found = await products.findByIds(wanted);

    expect(found.map((p) => p.id).sort()).toEqual([...wanted].sort());
    expect(await products.findByIds([])).toEqual([]);
  });

  it('filters by status and category', async () => {
    const statuses = [
      ProductStatus.ACTIVE,
      ProductStatus.DRAFT,
      ProductStatus.DISCONTINUED,
      ProductStatus.OUT_OF_STOCK,
    ];
    const rows = Array.from({ length: 120 }, (_, i) =>
      productRow(i, { status: statuses[i % 4], categoryId: `cat-${i % 6}` })
    );
    await bulkInsert(ds, Product, rows);

    expect(await products.findByStatus(ProductStatus.ACTIVE)).toHaveLength(30);
    expect(await products.findByStatus(ProductStatus.DISCONTINUED)).toHaveLength(30);
    const cat2 = await products.findByCategory('cat-2');
    expect(cat2).toHaveLength(20);
    expect(cat2.every((p) => p.categoryId === 'cat-2')).toBe(true);
    expect(await products.count({ status: ProductStatus.DRAFT, categoryId: 'cat-1' })).toBe(10);
  });
});
