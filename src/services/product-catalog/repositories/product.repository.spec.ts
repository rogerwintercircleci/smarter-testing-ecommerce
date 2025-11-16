/**
 * TDD: Product Repository Tests
 *
 * Comprehensive tests for product repository operations
 * Following strict TDD: Tests written first, then implementation
 */

import { Repository } from 'typeorm';
import { ProductRepository } from './product.repository';
import { Product, ProductStatus } from '../entities/product.entity';
import { NotFoundError, ConflictError } from '@libs/errors';

const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  merge: jest.fn(),
  createQueryBuilder: jest.fn(),
  metadata: { name: 'Product' },
} as unknown as Repository<Product>;

describe('ProductRepository', () => {
  let productRepository: ProductRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    productRepository = new ProductRepository(mockRepository);
  });

  describe('findBySku', () => {
    it('should find product by SKU', async () => {
      const mockProduct = {
        id: '123',
        sku: 'TEST-SKU-001',
        name: 'Test Product',
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);

      const result = await productRepository.findBySku('TEST-SKU-001');

      expect(result).toEqual(mockProduct);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { sku: 'TEST-SKU-001' },
      });
    });

    it('should return null if product not found', async () => {
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await productRepository.findBySku('NON-EXISTENT');

      expect(result).toBeNull();
    });

    it('should be case-sensitive for SKU', async () => {
      const mockProduct = { sku: 'TEST-SKU-001' } as Product;
      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);

      await productRepository.findBySku('TEST-SKU-001');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { sku: 'TEST-SKU-001' },
      });
    });
  });

  describe('skuExists', () => {
    it('should return true if SKU exists', async () => {
      (mockRepository.count as jest.Mock).mockResolvedValue(1);

      const result = await productRepository.skuExists('EXISTING-SKU');

      expect(result).toBe(true);
    });

    it('should return false if SKU does not exist', async () => {
      (mockRepository.count as jest.Mock).mockResolvedValue(0);

      const result = await productRepository.skuExists('NEW-SKU');

      expect(result).toBe(false);
    });
  });

  describe('createProduct', () => {
    it('should create a new product', async () => {
      const productData = {
        name: 'New Product',
        sku: 'NEW-SKU-001',
        price: 99.99,
        inventory: 10,
      };

      const mockProduct = { id: '456', ...productData } as Product;

      (mockRepository.count as jest.Mock).mockResolvedValue(0);
      (mockRepository.create as jest.Mock).mockReturnValue(mockProduct);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockProduct);

      const result = await productRepository.createProduct(productData);

      expect(result).toEqual(mockProduct);
    });

    it('should throw ConflictError if SKU already exists', async () => {
      const productData = {
        name: 'Product',
        sku: 'EXISTING-SKU',
        price: 99.99,
      };

      (mockRepository.count as jest.Mock).mockResolvedValue(1);

      await expect(productRepository.createProduct(productData)).rejects.toThrow(ConflictError);
      await expect(productRepository.createProduct(productData)).rejects.toThrow(
        'Product with this SKU already exists'
      );
    });
  });

  describe('findByStatus', () => {
    it('should find all products with specified status', async () => {
      const mockProducts = [
        { id: '1', status: ProductStatus.ACTIVE },
        { id: '2', status: ProductStatus.ACTIVE },
      ] as Product[];

      (mockRepository.find as jest.Mock).mockResolvedValue(mockProducts);

      const result = await productRepository.findByStatus(ProductStatus.ACTIVE);

      expect(result).toEqual(mockProducts);
    });

    it('should return empty array if no products found', async () => {
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      const result = await productRepository.findByStatus(ProductStatus.DISCONTINUED);

      expect(result).toEqual([]);
    });
  });

  describe('findByCategory', () => {
    it('should find all products in category', async () => {
      const mockProducts = [
        { id: '1', categoryId: 'cat-123' },
        { id: '2', categoryId: 'cat-123' },
      ] as Product[];

      (mockRepository.find as jest.Mock).mockResolvedValue(mockProducts);

      const result = await productRepository.findByCategory('cat-123');

      expect(result).toEqual(mockProducts);
    });

    it('should return empty array for category with no products', async () => {
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      const result = await productRepository.findByCategory('empty-cat');

      expect(result).toEqual([]);
    });
  });

  describe('updateInventory', () => {
    it('should update product inventory', async () => {
      const productId = '123';
      const newInventory = 50;
      const mockProduct = {
        id: productId,
        inventory: 10,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        inventory: newInventory,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        inventory: newInventory,
      });

      const result = await productRepository.updateInventory(productId, newInventory);

      expect(result.inventory).toBe(newInventory);
    });

    it('should throw NotFoundError if product not found', async () => {
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(productRepository.updateInventory('nonexistent', 10)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should allow setting inventory to zero', async () => {
      const mockProduct = { id: '123', inventory: 10 } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({ ...mockProduct, inventory: 0 });
      (mockRepository.save as jest.Mock).mockResolvedValue({ ...mockProduct, inventory: 0 });

      const result = await productRepository.updateInventory('123', 0);

      expect(result.inventory).toBe(0);
    });
  });

  describe('decrementInventory', () => {
    it('should decrement inventory by quantity', async () => {
      const mockProduct = {
        id: '123',
        inventory: 100,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        inventory: 95,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        inventory: 95,
      });

      const result = await productRepository.decrementInventory('123', 5);

      expect(result.inventory).toBe(95);
    });

    it('should not allow negative inventory', async () => {
      const mockProduct = {
        id: '123',
        inventory: 5,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);

      await expect(productRepository.decrementInventory('123', 10)).rejects.toThrow(
        'Insufficient inventory'
      );
    });

    it('should handle exact inventory match', async () => {
      const mockProduct = {
        id: '123',
        inventory: 10,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        inventory: 0,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        inventory: 0,
      });

      const result = await productRepository.decrementInventory('123', 10);

      expect(result.inventory).toBe(0);
    });
  });

  describe('incrementInventory', () => {
    it('should increment inventory by quantity', async () => {
      const mockProduct = {
        id: '123',
        inventory: 50,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        inventory: 75,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        inventory: 75,
      });

      const result = await productRepository.incrementInventory('123', 25);

      expect(result.inventory).toBe(75);
    });

    it('should increment from zero inventory', async () => {
      const mockProduct = {
        id: '123',
        inventory: 0,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        inventory: 10,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        inventory: 10,
      });

      const result = await productRepository.incrementInventory('123', 10);

      expect(result.inventory).toBe(10);
    });
  });

  describe('findLowStock', () => {
    it('should find products with inventory below threshold', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: '1', inventory: 3 },
          { id: '2', inventory: 5 },
        ]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await productRepository.findLowStock(10);

      expect(result).toHaveLength(2);
    });

    it('should only return active products with low stock', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await productRepository.findLowStock(5);

      expect(mockBuilder.where).toHaveBeenCalledWith(
        'product.status = :status',
        { status: ProductStatus.ACTIVE }
      );
    });
  });

  describe('findOnSale', () => {
    it('should find products on sale', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: '1', price: 79.99, compareAtPrice: 99.99 },
          { id: '2', price: 49.99, compareAtPrice: 79.99 },
        ]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await productRepository.findOnSale();

      expect(result).toHaveLength(2);
    });
  });

  describe('searchProducts', () => {
    it('should search products by name', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [{ id: '1', name: 'Test Product' }],
          1,
        ]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await productRepository.searchProducts('test', {});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should support pagination', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await productRepository.searchProducts('query', { page: 2, limit: 20 });

      expect(mockBuilder.skip).toHaveBeenCalledWith(20);
      expect(mockBuilder.take).toHaveBeenCalledWith(20);
    });

    it('should filter by price range', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await productRepository.searchProducts('query', {
        minPrice: 10,
        maxPrice: 100,
      });

      expect(mockBuilder.andWhere).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await productRepository.searchProducts('query', {
        categoryId: 'cat-123',
      });

      expect(mockBuilder.andWhere).toHaveBeenCalled();
    });
  });

  describe('updateRating', () => {
    it('should update product rating and review count', async () => {
      const mockProduct = {
        id: '123',
        rating: 4.0,
        reviewCount: 10,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        rating: 4.5,
        reviewCount: 11,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        rating: 4.5,
        reviewCount: 11,
      });

      const result = await productRepository.updateRating('123', 4.5, 11);

      expect(result.rating).toBe(4.5);
      expect(result.reviewCount).toBe(11);
    });
  });

  describe('incrementSoldCount', () => {
    it('should increment sold count', async () => {
      const mockProduct = {
        id: '123',
        soldCount: 10,
      } as Product;

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockProduct);
      (mockRepository.merge as jest.Mock).mockReturnValue({
        ...mockProduct,
        soldCount: 15,
      });
      (mockRepository.save as jest.Mock).mockResolvedValue({
        ...mockProduct,
        soldCount: 15,
      });

      const result = await productRepository.incrementSoldCount('123', 5);

      expect(result.soldCount).toBe(15);
    });
  });

  describe('findTopSelling', () => {
    it('should find top selling products', async () => {
      const mockProducts = [
        { id: '1', soldCount: 1000 },
        { id: '2', soldCount: 900 },
        { id: '3', soldCount: 800 },
      ] as Product[];

      (mockRepository.find as jest.Mock).mockResolvedValue(mockProducts);

      const result = await productRepository.findTopSelling(10);

      expect(result).toEqual(mockProducts);
    });

    it('should limit results to specified count', async () => {
      const mockProducts = [
        { id: '1', soldCount: 1000 },
        { id: '2', soldCount: 900 },
      ] as Product[];

      (mockRepository.find as jest.Mock).mockResolvedValue(mockProducts);

      await productRepository.findTopSelling(5);

      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });
  });

  describe('findTopRated', () => {
    it('should find top rated products', async () => {
      const mockProducts = [
        { id: '1', rating: 4.9, reviewCount: 100 },
        { id: '2', rating: 4.8, reviewCount: 150 },
      ] as Product[];

      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockProducts),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      const result = await productRepository.findTopRated(10);

      expect(result).toEqual(mockProducts);
    });

    it('should only include products with minimum reviews', async () => {
      const mockBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockBuilder);

      await productRepository.findTopRated(10, 5);

      expect(mockBuilder.andWhere).toHaveBeenCalledWith(
        'product.reviewCount >= :minReviews',
        { minReviews: 5 }
      );
    });
  });
});
