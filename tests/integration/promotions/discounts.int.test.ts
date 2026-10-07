import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { Discount } from '../../../src/services/promotions/entities/discount.entity';
import { DiscountRepository } from '../../../src/services/promotions/repositories/discount.repository';
import {
  CreateDiscountDto,
  DiscountService,
  DiscountType,
} from '../../../src/services/promotions/services/discount.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

const PAST = new Date('2020-01-01T00:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

describe('Discount codes (DiscountService + DiscountRepository, real Postgres)', () => {
  let ds: DataSource;
  let discounts: DiscountRepository;
  let service: DiscountService;

  beforeAll(async () => {
    ds = await createTestDatabase();
    discounts = new DiscountRepository(ds.getRepository(Discount));
    service = new DiscountService(discounts);
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
  });

  const create = (overrides: Partial<CreateDiscountDto> = {}) =>
    service.createDiscount({
      code: 'save15',
      type: DiscountType.PERCENTAGE,
      value: 15,
      description: '15% off',
      ...overrides,
    });

  it('stores codes in upper case and finds them case-insensitively', async () => {
    const created = await create();
    expect(created.code).toBe('SAVE15');

    const found = await discounts.findByCode('Save15');
    expect(found!.id).toBe(created.id);
    expect(found!.isActive).toBe(true);
    expect(found!.usageCount).toBe(0);
  });

  it('rejects invalid discount definitions', async () => {
    await expect(create({ value: 120 })).rejects.toThrow('Percentage discount cannot exceed 100%');
    await expect(create({ type: DiscountType.FIXED_AMOUNT, value: -5 })).rejects.toThrow(
      'Discount value must be positive'
    );
    expect(await discounts.count()).toBe(0);
  });

  it('enforces code uniqueness in the database', async () => {
    await create();
    await expect(create({ code: 'SAVE15' })).rejects.toThrow(/duplicate key/);
  });

  it('explains why a code is not valid', async () => {
    await create({ code: 'OLD', expiresAt: PAST });
    await create({ code: 'SOON', startsAt: FUTURE });
    await create({ code: 'USED', maxUsageCount: 2 });
    const off = await create({ code: 'OFF' });
    await service.deactivateDiscount(off.id);
    await discounts.getRepository().update({ code: 'USED' }, { usageCount: 2 });

    await expect(service.validateDiscount('missing')).resolves.toEqual({
      isValid: false,
      reason: 'Discount code not found',
    });
    await expect(service.validateDiscount('old')).resolves.toMatchObject({ reason: 'Discount code has expired' });
    await expect(service.validateDiscount('soon')).resolves.toMatchObject({
      reason: 'Discount code is not yet active',
    });
    await expect(service.validateDiscount('used')).resolves.toMatchObject({
      reason: 'Discount code has reached maximum usage limit',
    });
    await expect(service.validateDiscount('off')).resolves.toMatchObject({ reason: 'Discount code is not active' });
  });

  it('accepts a code inside its validity window', async () => {
    await create({ code: 'WINDOW', startsAt: PAST, expiresAt: FUTURE });
    const result = await service.validateDiscount('window');
    expect(result.isValid).toBe(true);
    expect(result.discount.code).toBe('WINDOW');
  });

  it('applies a capped percentage discount', async () => {
    await create({ code: 'PCT20', value: 20, maxDiscountAmount: 30 });

    await expect(service.applyDiscount({ code: 'pct20', orderSubtotal: 100, userId: 'u1' })).resolves.toMatchObject({
      discountAmount: 20,
      finalAmount: 80,
    });
    await expect(service.applyDiscount({ code: 'pct20', orderSubtotal: 400, userId: 'u1' })).resolves.toMatchObject({
      discountAmount: 30,
      finalAmount: 370,
    });
  });

  it('applies a fixed discount without going below zero', async () => {
    await create({ code: 'TENOFF', type: DiscountType.FIXED_AMOUNT, value: 10 });

    const normal = await service.applyDiscount({ code: 'TENOFF', orderSubtotal: 45, userId: 'u1' });
    expect(Number(normal.discountAmount)).toBe(10);
    expect(normal.finalAmount).toBe(35);

    const small = await service.applyDiscount({ code: 'TENOFF', orderSubtotal: 6, userId: 'u1' });
    expect(Number(small.discountAmount)).toBe(6);
    expect(small.finalAmount).toBe(0);
  });

  it('waives shipping for a free-shipping code', async () => {
    await create({ code: 'SHIPFREE', type: DiscountType.FREE_SHIPPING, value: 0 });
    const result = await service.applyDiscount({
      code: 'SHIPFREE',
      orderSubtotal: 60,
      shippingCost: 8.5,
      userId: 'u1',
    });
    expect(result).toEqual({ discountAmount: 0, finalAmount: 60, freeShipping: true, shippingDiscount: 8.5 });
  });

  it('enforces a minimum purchase amount', async () => {
    await create({ code: 'BIGSPEND', minPurchaseAmount: 100 });
    await expect(
      service.applyDiscount({ code: 'BIGSPEND', orderSubtotal: 99, userId: 'u1' })
    ).rejects.toThrow(new BadRequestError('Order must meet minimum purchase amount of $100'));
    await expect(
      service.applyDiscount({ code: 'BIGSPEND', orderSubtotal: 100, userId: 'u1' })
    ).resolves.toHaveProperty('discountAmount', 15);
  });

  it('counts redemptions and stops at the usage limit', async () => {
    const limited = await create({ code: 'LIMIT3', maxUsageCount: 3 });

    for (let i = 0; i < 3; i++) {
      await service.applyDiscount({ code: 'LIMIT3', orderSubtotal: 50, userId: `u${i}` });
    }
    await expect(service.applyDiscount({ code: 'LIMIT3', orderSubtotal: 50, userId: 'u9' })).rejects.toThrow(
      'Discount code has reached maximum usage limit'
    );

    expect((await discounts.findById(limited.id)).usageCount).toBe(3);
    await expect(service.getDiscountUsageStats(limited.id)).resolves.toEqual({
      totalUsage: 3,
      remainingUsage: 0,
      usagePercentage: 100,
    });
  });

  it('increments usage atomically under concurrent redemptions', async () => {
    const promo = await create({ code: 'FLASH' });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        service.applyDiscount({ code: 'FLASH', orderSubtotal: 20 + i, userId: `u${i}` })
      )
    );

    expect((await discounts.findById(promo.id)).usageCount).toBe(40);
    await expect(service.getDiscountUsageStats(promo.id)).resolves.toEqual({
      totalUsage: 40,
      remainingUsage: null,
      usagePercentage: 0,
    });
  });

  it('previews savings without redeeming the code', async () => {
    const pct = await create({ code: 'PREVIEW', value: 25, maxDiscountAmount: 40 });
    await create({ code: 'FIVER', type: DiscountType.FIXED_AMOUNT, value: 5 });

    await expect(service.calculateSavings('preview', 100)).resolves.toBe(25);
    await expect(service.calculateSavings('preview', 1000)).resolves.toBe(40);
    expect(Number(await service.calculateSavings('fiver', 3))).toBe(3);
    await expect(service.calculateSavings('nope', 100)).resolves.toBe(0);
    expect((await discounts.findById(pct.id)).usageCount).toBe(0);
  });

  it('lists only active codes and deletes codes', async () => {
    const a = await create({ code: 'A' });
    await create({ code: 'B' });
    const c = await create({ code: 'C' });
    await service.deactivateDiscount(a.id);

    expect((await service.getActiveDiscounts()).map((d) => d.code).sort()).toEqual(['B', 'C']);

    await service.deleteDiscount(c.id);
    expect(await discounts.findByCode('C')).toBeNull();
    await expect(service.deleteDiscount(c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deactivateDiscount(c.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
