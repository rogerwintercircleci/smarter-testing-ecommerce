import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { addMinutes, BASE_DATE, bulkInsert, productRow } from '../support/fixtures';
import { Product } from '../../../src/services/product-catalog/entities/product.entity';
import { WishlistItem } from '../../../src/services/wishlist/entities/wishlist.entity';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { WishlistRepository } from '../../../src/services/wishlist/repositories/wishlist.repository';
import { WishlistService } from '../../../src/services/wishlist/services/wishlist.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

describe('Wishlists (WishlistService + repositories, real Postgres)', () => {
  let ds: DataSource;
  let products: ProductRepository;
  let wishlist: WishlistRepository;
  let service: WishlistService;
  let catalog: Product[];

  beforeAll(async () => {
    ds = await createTestDatabase();
    products = new ProductRepository(ds.getRepository(Product));
    wishlist = new WishlistRepository(ds.getRepository(WishlistItem));
    service = new WishlistService(wishlist, products);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
    await bulkInsert(
      ds,
      Product,
      Array.from({ length: 60 }, (_, i) => productRow(i, { price: 5 + i, inventory: i % 10 === 0 ? 0 : 25 }))
    );
    catalog = await products.findAll({ order: { sku: 'ASC' } });
  });

  it('adds a product with a note and refuses duplicates', async () => {
    const item = await service.addToWishlist({ userId: 'u1', productId: catalog[3].id, note: 'Birthday' });

    expect((await wishlist.findById(item.id)).note).toBe('Birthday');
    await expect(service.addToWishlist({ userId: 'u1', productId: catalog[3].id })).rejects.toThrow(
      new BadRequestError('Product is already in wishlist')
    );
    expect(await service.getWishlistCount('u1')).toBe(1);
  });

  it('refuses products that do not exist', async () => {
    await expect(
      service.addToWishlist({ userId: 'u1', productId: '00000000-0000-4000-8000-000000000000' })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await wishlist.count()).toBe(0);
  });

  it('returns the wishlist newest first with product details joined in', async () => {
    const chosen = [catalog[1], catalog[7], catalog[22], catalog[41]];
    for (const [i, product] of chosen.entries()) {
      await wishlist.create({ userId: 'u1', productId: product.id, createdAt: addMinutes(BASE_DATE, i) });
    }
    await wishlist.create({ userId: 'someone-else', productId: catalog[2].id });

    const items = await service.getWishlist('u1', { sortBy: 'recent' });

    expect(items.map((i) => i.product!.sku)).toEqual([...chosen].reverse().map((p) => p.sku));
    expect(items[0].product!.name).toBe(chosen[3].name);
    await expect(service.getWishlist('nobody')).resolves.toEqual([]);
  });

  it('filters the wishlist by product price', async () => {
    for (const product of catalog.slice(0, 30)) {
      await service.addToWishlist({ userId: 'u1', productId: product.id });
    }

    const midRange = await service.getWishlist('u1', { minPrice: 10, maxPrice: 20 });

    // Fixture prices are 5 + index, so indices 5..15 fall inside the range.
    expect(midRange.map((i) => i.product!.sku).sort()).toEqual(
      catalog.slice(5, 16).map((p) => p.sku).sort()
    );
  });

  it('removes single items and clears a whole wishlist', async () => {
    for (const product of catalog.slice(0, 5)) {
      await service.addToWishlist({ userId: 'u1', productId: product.id });
      await service.addToWishlist({ userId: 'u2', productId: product.id });
    }

    await service.removeFromWishlist('u1', catalog[2].id);
    expect(await service.isInWishlist('u1', catalog[2].id)).toBe(false);
    expect(await service.getWishlistCount('u1')).toBe(4);
    await expect(service.removeFromWishlist('u1', catalog[2].id)).rejects.toThrow('Item not found in wishlist');

    await service.clearWishlist('u1');
    expect(await service.getWishlistCount('u1')).toBe(0);
    expect(await service.getWishlistCount('u2')).toBe(5);
  });

  it('moves an item to the cart and removes it from the wishlist', async () => {
    await service.addToWishlist({ userId: 'u1', productId: catalog[4].id });

    await expect(service.moveToCart('u1', catalog[4].id)).resolves.toMatchObject({ success: true });
    expect(await service.isInWishlist('u1', catalog[4].id)).toBe(false);
    await expect(service.moveToCart('u1', catalog[4].id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('adds many products at once, skipping ones already saved', async () => {
    await service.addToWishlist({ userId: 'u1', productId: catalog[0].id });
    await service.addToWishlist({ userId: 'u1', productId: catalog[1].id });

    const result = await service.addMultipleToWishlist('u1', catalog.slice(0, 40).map((p) => p.id));

    expect(result).toEqual({ added: 38, failed: 0 });
    expect(await service.getWishlistCount('u1')).toBe(40);
  });

  it('reports saved items that are out of stock', async () => {
    await service.addMultipleToWishlist('u1', catalog.slice(0, 35).map((p) => p.id));

    const outOfStock = await service.getOutOfStockItems('u1');

    expect(outOfStock.map((i) => i.product!.sku).sort()).toEqual(
      [catalog[0], catalog[10], catalog[20], catalog[30]].map((p) => p.sku).sort()
    );
  });

  it('alerts when a saved product becomes cheaper than when it was added', async () => {
    const [cheaper, same, pricier] = [catalog[20], catalog[21], catalog[22]];
    await wishlist.create({ userId: 'u1', productId: cheaper.id, priceWhenAdded: 40 });
    await wishlist.create({ userId: 'u1', productId: same.id, priceWhenAdded: 26 });
    await wishlist.create({ userId: 'u1', productId: pricier.id, priceWhenAdded: 20 });
    await wishlist.create({ userId: 'u1', productId: catalog[23].id });

    const alerts = await service.getPriceDropAlerts('u1');

    // cheaper costs 25 now (5 + 20) against 40 when saved.
    expect(alerts.map((a) => ({ sku: a.product!.sku, drop: a.priceDrop }))).toEqual([
      { sku: cheaper.sku, drop: 15 },
    ]);
  });

  it('issues unique share links', async () => {
    const first = await service.shareWishlist('u1');
    const second = await service.shareWishlist('u1');
    expect(first.shareToken).toMatch(/^[0-9a-f]{32}$/);
    expect(first.shareUrl).toContain(first.shareToken);
    expect(second.shareToken).not.toBe(first.shareToken);
  });
});
