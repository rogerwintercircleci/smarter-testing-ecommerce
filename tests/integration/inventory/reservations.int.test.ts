import { DataSource, Repository } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { seededRandom } from '../support/fixtures';
import { Inventory, InventoryReservation } from '../../../src/services/inventory/entities/inventory.entity';
import { Product } from '../../../src/services/product-catalog/entities/product.entity';
import { InventoryRepository } from '../../../src/services/inventory/repositories/inventory.repository';
import { ProductRepository } from '../../../src/services/product-catalog/repositories/product.repository';
import { InventoryService } from '../../../src/services/inventory/services/inventory.service';
import { ConflictError } from '../../../src/libs/errors';

const MINUTE = 60 * 1000;
const LONG_AGO = new Date('2020-03-01T12:00:00.000Z');
const FAR_FUTURE = new Date('2099-03-01T12:00:00.000Z');

describe('Stock reservations and expiry (InventoryService + InventoryRepository, real Postgres)', () => {
  let ds: DataSource;
  let inventory: InventoryRepository;
  let reservations: Repository<InventoryReservation>;
  let service: InventoryService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    inventory = new InventoryRepository(ds.getRepository(Inventory), ds.getRepository(InventoryReservation));
    reservations = ds.getRepository(InventoryReservation);
    service = new InventoryService(inventory, new ProductRepository(ds.getRepository(Product)));
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  it('creates an empty inventory record on first lookup', async () => {
    const stock = await service.getStock('brand-new-sku');
    expect(stock).toMatchObject({ productId: 'brand-new-sku', quantity: 0, reserved: 0, available: 0 });
    expect(await inventory.count({ productId: 'brand-new-sku' })).toBe(1);
  });

  it('holds stock for 15 minutes by default and reduces availability', async () => {
    await inventory.update('sku-1', { quantity: 20 });
    const before = Date.now();

    const reservation = await service.reserveStock({ productId: 'sku-1', quantity: 6, orderId: 'order-1' });

    expect(reservation.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 15 * MINUTE - 1000);
    expect(reservation.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * MINUTE + 1000);
    const stock = await service.getStock('sku-1');
    expect(stock).toMatchObject({ quantity: 20, reserved: 6, available: 14 });
    expect(await service.checkAvailability('sku-1', 14)).toBe(true);
    expect(await service.checkAvailability('sku-1', 15)).toBe(false);
  });

  it('honours a custom reservation window', async () => {
    await inventory.update('sku-1', { quantity: 5 });
    const before = Date.now();
    const reservation = await service.reserveStock({
      productId: 'sku-1',
      quantity: 1,
      orderId: 'order-1',
      expirationMinutes: 90,
    });
    expect(reservation.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 90 * MINUTE - 1000);
  });

  it('refuses to reserve more than is available after existing holds', async () => {
    await inventory.update('sku-1', { quantity: 10 });
    await service.reserveStock({ productId: 'sku-1', quantity: 7, orderId: 'order-1' });

    await expect(
      service.reserveStock({ productId: 'sku-1', quantity: 4, orderId: 'order-2' })
    ).rejects.toThrow(new ConflictError('Insufficient stock available'));
    expect(await reservations.count()).toBe(1);
    expect((await service.getStock('sku-1')).reserved).toBe(7);
  });

  it('releases a reservation and returns its stock to the pool', async () => {
    await inventory.update('sku-1', { quantity: 10 });
    const reservation = await service.reserveStock({ productId: 'sku-1', quantity: 4, orderId: 'order-1' });

    await service.releaseReservation(reservation.id);

    expect(await reservations.count()).toBe(0);
    expect(await service.getStock('sku-1')).toMatchObject({ reserved: 0, available: 10 });
    await expect(service.releaseReservation(reservation.id)).rejects.toThrow('Reservation not found');
  });

  it('confirms a reservation by consuming the held stock', async () => {
    await inventory.update('sku-1', { quantity: 10 });
    const reservation = await service.reserveStock({ productId: 'sku-1', quantity: 3, orderId: 'order-1' });

    const updated = await service.confirmReservation(reservation.id);

    expect(updated.quantity).toBe(7);
    expect(await reservations.count()).toBe(0);
    const stock = await service.getStock('sku-1');
    expect(stock.quantity).toBe(7);
    expect(stock.available).toBe(7);
  });

  it('confirms one reservation without releasing stock held for other orders', async () => {
    await inventory.update('sku-1', { quantity: 10 });
    const first = await service.reserveStock({ productId: 'sku-1', quantity: 3, orderId: 'order-1' });
    await service.reserveStock({ productId: 'sku-1', quantity: 4, orderId: 'order-2' });

    const updated = await service.confirmReservation(first.id);

    expect(updated).toMatchObject({ quantity: 7, reserved: 4 });
    expect(await service.getStock('sku-1')).toMatchObject({ quantity: 7, reserved: 4, available: 3 });
    expect(await reservations.count()).toBe(1);
  });

  it('identifies only reservations whose expiry has passed', async () => {
    await inventory.update('sku-1', { quantity: 100 });
    await inventory.createReservation({ productId: 'sku-1', orderId: 'old', quantity: 2, expiresAt: LONG_AGO });
    await inventory.createReservation({ productId: 'sku-1', orderId: 'live', quantity: 3, expiresAt: FAR_FUTURE });

    const expired = await inventory.findExpiredReservations();

    expect(expired.map((r) => r.orderId)).toEqual(['old']);
  });

  it('sweeps expired holds across many products and restores availability', async () => {
    const productCount = 30;
    const rand = seededRandom(314);
    const live = new Map<string, number>();
    let expiredCount = 0;

    for (let p = 0; p < productCount; p++) {
      await inventory.update(`sku-${p}`, { quantity: 1000 });
      live.set(`sku-${p}`, 0);
    }
    for (let i = 0; i < 300; i++) {
      const productId = `sku-${Math.floor(rand() * productCount)}`;
      const quantity = 1 + Math.floor(rand() * 5);
      const isExpired = rand() < 0.5;
      // Spread the fixed timestamps over a month on either side of "now".
      const offsetMs = Math.floor(rand() * 30 * 24 * 60) * MINUTE;
      await inventory.createReservation({
        productId,
        orderId: `order-${i}`,
        quantity,
        expiresAt: new Date((isExpired ? LONG_AGO : FAR_FUTURE).getTime() + offsetMs),
      });
      if (isExpired) expiredCount += 1;
      else live.set(productId, live.get(productId)! + quantity);
    }

    const result = await service.releaseExpiredReservations();

    expect(result.releasedCount).toBe(expiredCount);
    expect(await reservations.count()).toBe(300 - expiredCount);
    for (const [productId, reserved] of live) {
      const stock = await service.getStock(productId);
      expect({ productId, reserved: stock.reserved, available: stock.available }).toEqual({
        productId,
        reserved,
        available: 1000 - reserved,
      });
    }
    await expect(service.releaseExpiredReservations()).resolves.toEqual({ releasedCount: 0 });
  });
});
