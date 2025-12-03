/**
 * TDD Implementation: Product Service
 *
 * Business logic layer for product management
 * Implements all functionality to pass tests in product.service.spec.ts
 */

import { ProductRepository, SearchProductsOptions, SearchProductsResult } from '../repositories/product.repository';
import { Product, ProductStatus } from '../entities/product.entity';
import { BadRequestError } from '@libs/errors';

export interface CreateProductDto {
  name: string;
  description: string;
  sku: string;
  price: number;
  compareAtPrice?: number;
  inventory: number;
  categoryId?: string;
  images?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProductDto {
  name?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  categoryId?: string;
  images?: string[];
  metadata?: Record<string, unknown>;
}

export class ProductService {
  constructor(private productRepository: ProductRepository) {}

  /**
   * Create new product with validation
   */
  async createProduct(data: CreateProductDto): Promise<Product> {
    // Validate price
    if (data.price <= 0) {
      throw new BadRequestError('Price must be positive');
    }

    // Validate inventory
    if (data.inventory < 0) {
      throw new BadRequestError('Inventory cannot be negative');
    }

    // Validate compareAtPrice if provided
    if (data.compareAtPrice !== undefined) {
      if (data.compareAtPrice <= data.price) {
        throw new BadRequestError('Compare at price must be higher than price');
      }
    }

    return this.productRepository.createProduct(data);
  }

  /**
   * Get product by ID
   */
  async getProductById(productId: string): Promise<Product> {
    return this.productRepository.findById(productId);
  }

  /**
   * Update product
   */
  async updateProduct(productId: string, data: UpdateProductDto): Promise<Product> {
    // Validate price if being updated
    if (data.price !== undefined && data.price <= 0) {
      throw new BadRequestError('Price must be positive');
    }

    // Validate compareAtPrice if being updated
    if (data.compareAtPrice !== undefined && data.price !== undefined) {
      if (data.compareAtPrice <= data.price) {
        throw new BadRequestError('Compare at price must be higher than price');
      }
    }

    return this.productRepository.update(productId, data);
  }

  /**
   * Delete product
   */
  async deleteProduct(productId: string): Promise<void> {
    await this.productRepository.delete(productId);
  }

  /**
   * Publish product (make it active)
   */
  async publishProduct(productId: string): Promise<Product> {
    return this.productRepository.update(productId, {
      status: ProductStatus.ACTIVE,
    });
  }

  /**
   * Unpublish product (make it draft)
   */
  async unpublishProduct(productId: string): Promise<Product> {
    return this.productRepository.update(productId, {
      status: ProductStatus.DRAFT,
    });
  }

  /**
   * Update inventory
   */
  async updateInventory(productId: string, inventory: number): Promise<Product> {
    if (inventory < 0) {
      throw new BadRequestError('Inventory cannot be negative');
    }

    return this.productRepository.updateInventory(productId, inventory);
  }

  /**
   * Reserve inventory for purchase
   */
  async reserveInventory(productId: string, quantity: number): Promise<Product> {
    if (quantity <= 0) {
      throw new BadRequestError('Quantity must be positive');
    }

    return this.productRepository.decrementInventory(productId, quantity);
  }

  /**
   * Restock inventory
   */
  async restockInventory(productId: string, quantity: number): Promise<Product> {
    if (quantity <= 0) {
      throw new BadRequestError('Quantity must be positive');
    }

    return this.productRepository.incrementInventory(productId, quantity);
  }

  /**
   * Get products with low stock
   */
  async getLowStockProducts(threshold: number = 10): Promise<Product[]> {
    return this.productRepository.findLowStock(threshold);
  }

  /**
   * Get products on sale
   */
  async getProductsOnSale(): Promise<Product[]> {
    return this.productRepository.findOnSale();
  }

  /**
   * Search products with filters
   */
  async searchProducts(
    query: string,
    options: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    return this.productRepository.searchProducts(query, options);
  }

  /**
   * Record a sale (decrement inventory and increment sold count)
   */
  async recordSale(productId: string, quantity: number): Promise<void> {
    await this.productRepository.decrementInventory(productId, quantity);
    await this.productRepository.incrementSoldCount(productId, quantity);
  }

  /**
   * Update product rating
   */
  async updateProductRating(
    productId: string,
    newRating: number,
    reviewCount: number
  ): Promise<Product> {
    // Validate rating
    if (newRating < 1 || newRating > 5) {
      throw new BadRequestError('Rating must be between 1 and 5');
    }

    // Get current product to calculate new average
    const product = await this.productRepository.findById(productId);

    // Calculate new average rating
    const totalRating = product.rating * product.reviewCount + newRating * reviewCount;
    const totalReviews = product.reviewCount + reviewCount;
    const newAverageRating = totalRating / totalReviews;

    return this.productRepository.updateRating(
      productId,
      Math.round(newAverageRating * 10) / 10, // Round to 1 decimal
      totalReviews
    );
  }

  /**
   * Get top selling products
   */
  async getTopSellingProducts(limit: number = 10): Promise<Product[]> {
    return this.productRepository.findTopSelling(limit);
  }

  /**
   * Get top rated products
   */
  async getTopRatedProducts(limit: number = 10, minReviews: number = 5): Promise<Product[]> {
    return this.productRepository.findTopRated(limit, minReviews);
  }
}
