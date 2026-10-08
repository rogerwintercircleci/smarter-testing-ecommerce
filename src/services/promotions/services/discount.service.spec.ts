/**
 * TDD: Discount/Coupon Service Tests
 *
 * Testing comprehensive discount and coupon functionality
 */

import { DiscountService, CreateDiscountDto, DiscountType, ApplyDiscountDto } from './discount.service';
import { DiscountRepository } from '../repositories/discount.repository';
import { BadRequestError } from '@libs/errors';

describe('DiscountService', () => {
  let discountService: DiscountService;
  let mockDiscountRepository: jest.Mocked<DiscountRepository>;

  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();

    mockDiscountRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByCode: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findActive: jest.fn(),
      incrementUsageCount: jest.fn(),
      findByUserId: jest.fn(),
    } as any;

    discountService = new DiscountService(mockDiscountRepository);
  });

  describe('createDiscount', () => {
    it('should create a percentage discount code', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'SAVE20',
        type: DiscountType.PERCENTAGE,
        value: 20,
        description: '20% off',
        expiresAt: new Date('2025-12-31'),
      };

      const mockDiscount = {
        id: '1',
        ...discountDto,
        usageCount: 0,
        isActive: true,
        createdAt: new Date(),
      };

      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result).toEqual(mockDiscount);
      expect(mockDiscountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SAVE20',
          type: DiscountType.PERCENTAGE,
          value: 20,
        })
      );
    });

    it('should create a fixed amount discount code', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'SAVE10',
        type: DiscountType.FIXED_AMOUNT,
        value: 10,
        description: '$10 off',
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.type).toBe(DiscountType.FIXED_AMOUNT);
      expect(result.value).toBe(10);
    });

    it('should create a free shipping discount', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'FREESHIP',
        type: DiscountType.FREE_SHIPPING,
        value: 0,
        description: 'Free shipping',
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.type).toBe(DiscountType.FREE_SHIPPING);
    });

    it('should reject percentage discount over 100%', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'INVALID',
        type: DiscountType.PERCENTAGE,
        value: 150,
        description: 'Invalid discount',
      };

      await expect(discountService.createDiscount(discountDto)).rejects.toThrow(BadRequestError);
      await expect(discountService.createDiscount(discountDto)).rejects.toThrow('Percentage discount cannot exceed 100%');
    });

    it('should reject negative discount values', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'INVALID',
        type: DiscountType.FIXED_AMOUNT,
        value: -10,
        description: 'Invalid discount',
      };

      await expect(discountService.createDiscount(discountDto)).rejects.toThrow(BadRequestError);
    });

    it('should create discount with minimum purchase requirement', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'MIN50',
        type: DiscountType.PERCENTAGE,
        value: 15,
        description: '15% off orders over $50',
        minPurchaseAmount: 50,
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.minPurchaseAmount).toBe(50);
    });

    it('should create discount with maximum discount cap', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'SAVE20MAX10',
        type: DiscountType.PERCENTAGE,
        value: 20,
        description: '20% off (max $10)',
        maxDiscountAmount: 10,
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.maxDiscountAmount).toBe(10);
    });

    it('should create discount with usage limit', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'LIMITED100',
        type: DiscountType.FIXED_AMOUNT,
        value: 5,
        description: 'Limited to 100 uses',
        maxUsageCount: 100,
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.maxUsageCount).toBe(100);
    });

    it('should create discount with per-user limit', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'ONCE',
        type: DiscountType.PERCENTAGE,
        value: 10,
        description: 'One time use per customer',
        maxUsagePerUser: 1,
      };

      const mockDiscount = { id: '1', ...discountDto, usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.maxUsagePerUser).toBe(1);
    });

    it('should normalize discount code to uppercase', async () => {
      const discountDto: CreateDiscountDto = {
        code: 'save20',
        type: DiscountType.PERCENTAGE,
        value: 20,
        description: '20% off',
      };

      const mockDiscount = { id: '1', ...discountDto, code: 'SAVE20', usageCount: 0, isActive: true };
      mockDiscountRepository.create.mockResolvedValue(mockDiscount as any);

      const result = await discountService.createDiscount(discountDto);

      expect(result.code).toBe('SAVE20');
    });
  });

  describe('validateDiscount', () => {
    it('should validate an active discount code', async () => {
      const mockDiscount = {
        id: '1',
        code: 'VALID',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
        usageCount: 5,
        expiresAt: new Date('2030-12-31'),
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const result = await discountService.validateDiscount('VALID');

      expect(result.isValid).toBe(true);
      expect(result.discount).toEqual(mockDiscount);
    });

    it('should reject non-existent discount code', async () => {
      mockDiscountRepository.findByCode.mockResolvedValue(null);

      const result = await discountService.validateDiscount('INVALID');

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Discount code not found');
    });

    it('should reject inactive discount code', async () => {
      const mockDiscount = {
        id: '1',
        code: 'INACTIVE',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: false,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const result = await discountService.validateDiscount('INACTIVE');

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Discount code is not active');
    });

    it('should reject expired discount code', async () => {
      const mockDiscount = {
        id: '1',
        code: 'EXPIRED',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
        expiresAt: new Date('2020-01-01'),
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const result = await discountService.validateDiscount('EXPIRED');

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Discount code has expired');
    });

    it('should reject discount that has not started yet', async () => {
      const mockDiscount = {
        id: '1',
        code: 'FUTURE',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
        startsAt: new Date('2030-01-01'),
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const result = await discountService.validateDiscount('FUTURE');

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Discount code is not yet active');
    });

    it('should reject discount that reached max usage limit', async () => {
      const mockDiscount = {
        id: '1',
        code: 'MAXED',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
        usageCount: 100,
        maxUsageCount: 100,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const result = await discountService.validateDiscount('MAXED');

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Discount code has reached maximum usage limit');
    });
  });

  describe('applyDiscount', () => {
    it('should apply percentage discount to order', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'SAVE20',
        orderSubtotal: 100,
        userId: 'user123',
      };

      const result = await discountService.applyDiscount(applyDto);

      expect(result.discountAmount).toBe(20);
      expect(result.finalAmount).toBe(80);
    });

    it('should apply fixed amount discount to order', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE10',
        type: DiscountType.FIXED_AMOUNT,
        value: 10,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'SAVE10',
        orderSubtotal: 50,
        userId: 'user123',
      };

      const result = await discountService.applyDiscount(applyDto);

      expect(result.discountAmount).toBe(10);
      expect(result.finalAmount).toBe(40);
    });

    it('should apply free shipping discount', async () => {
      const mockDiscount = {
        id: '1',
        code: 'FREESHIP',
        type: DiscountType.FREE_SHIPPING,
        value: 0,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'FREESHIP',
        orderSubtotal: 100,
        shippingCost: 10,
        userId: 'user123',
      };

      const result = await discountService.applyDiscount(applyDto);

      expect(result.freeShipping).toBe(true);
      expect(result.shippingDiscount).toBe(10);
    });

    it('should cap percentage discount at maximum amount', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20MAX10',
        type: DiscountType.PERCENTAGE,
        value: 20,
        maxDiscountAmount: 10,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'SAVE20MAX10',
        orderSubtotal: 100, // 20% would be $20, but capped at $10
        userId: 'user123',
      };

      const result = await discountService.applyDiscount(applyDto);

      expect(result.discountAmount).toBe(10);
      expect(result.finalAmount).toBe(90);
    });

    it('should reject discount if order does not meet minimum purchase', async () => {
      const mockDiscount = {
        id: '1',
        code: 'MIN50',
        type: DiscountType.PERCENTAGE,
        value: 15,
        minPurchaseAmount: 50,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'MIN50',
        orderSubtotal: 30,
        userId: 'user123',
      };

      await expect(discountService.applyDiscount(applyDto)).rejects.toThrow(BadRequestError);
      await expect(discountService.applyDiscount(applyDto)).rejects.toThrow('minimum purchase amount');
    });

    it('should not allow discount to exceed order subtotal', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE50',
        type: DiscountType.FIXED_AMOUNT,
        value: 50,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const applyDto: ApplyDiscountDto = {
        code: 'SAVE50',
        orderSubtotal: 30,
        userId: 'user123',
      };

      const result = await discountService.applyDiscount(applyDto);

      expect(result.discountAmount).toBe(30); // Capped at subtotal
      expect(result.finalAmount).toBe(0);
    });

    it('should increment usage count when discount is applied', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
        usageCount: 5,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);
      mockDiscountRepository.incrementUsageCount.mockResolvedValue(undefined);

      const applyDto: ApplyDiscountDto = {
        code: 'SAVE20',
        orderSubtotal: 100,
        userId: 'user123',
      };

      await discountService.applyDiscount(applyDto);

      expect(mockDiscountRepository.incrementUsageCount).toHaveBeenCalledWith('1', 'user123');
    });

    it('should reject discount if user has exceeded per-user limit', async () => {
      const mockDiscount = {
        id: '1',
        code: 'ONCE',
        type: DiscountType.PERCENTAGE,
        value: 10,
        maxUsagePerUser: 1,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);
      mockDiscountRepository.findByUserId.mockResolvedValue([
        { discountId: '1', userId: 'user123', usedAt: new Date() },
      ] as any);

      const applyDto: ApplyDiscountDto = {
        code: 'ONCE',
        orderSubtotal: 100,
        userId: 'user123',
      };

      await expect(discountService.applyDiscount(applyDto)).rejects.toThrow(BadRequestError);
      await expect(discountService.applyDiscount(applyDto)).rejects.toThrow('already used this discount');
    });
  });

  describe('getActiveDiscounts', () => {
    it('should return all active discounts', async () => {
      const mockDiscounts = [
        { id: '1', code: 'SAVE20', isActive: true, type: DiscountType.PERCENTAGE, value: 20 },
        { id: '2', code: 'SAVE10', isActive: true, type: DiscountType.FIXED_AMOUNT, value: 10 },
      ];

      mockDiscountRepository.findActive.mockResolvedValue(mockDiscounts as any);

      const result = await discountService.getActiveDiscounts();

      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('SAVE20');
    });
  });

  describe('deactivateDiscount', () => {
    it('should deactivate a discount code', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20',
        isActive: true,
      };

      mockDiscountRepository.findById.mockResolvedValue(mockDiscount as any);
      mockDiscountRepository.update.mockResolvedValue({ ...mockDiscount, isActive: false } as any);

      const result = await discountService.deactivateDiscount('1');

      expect(result.isActive).toBe(false);
      expect(mockDiscountRepository.update).toHaveBeenCalledWith('1', { isActive: false });
    });
  });

  describe('getDiscountUsageStats', () => {
    it('should return usage statistics for a discount', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20',
        usageCount: 150,
        maxUsageCount: 200,
      };

      mockDiscountRepository.findById.mockResolvedValue(mockDiscount as any);

      const result = await discountService.getDiscountUsageStats('1');

      expect(result.totalUsage).toBe(150);
      expect(result.remainingUsage).toBe(50);
      expect(result.usagePercentage).toBe(75);
    });
  });

  describe('calculateSavings', () => {
    it('should calculate total savings from discount', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE20',
        type: DiscountType.PERCENTAGE,
        value: 20,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const savings = await discountService.calculateSavings('SAVE20', 100);

      expect(savings).toBe(20);
    });

    it('should calculate savings for fixed amount discount', async () => {
      const mockDiscount = {
        id: '1',
        code: 'SAVE15',
        type: DiscountType.FIXED_AMOUNT,
        value: 15,
        isActive: true,
      };

      mockDiscountRepository.findByCode.mockResolvedValue(mockDiscount as any);

      const savings = await discountService.calculateSavings('SAVE15', 100);

      expect(savings).toBe(15);
    });
  });

  describe('deleteDiscount', () => {
    it('should delete a discount code', async () => {
      mockDiscountRepository.delete.mockResolvedValue(undefined);

      await discountService.deleteDiscount('1');

      expect(mockDiscountRepository.delete).toHaveBeenCalledWith('1');
    });
  });
});
