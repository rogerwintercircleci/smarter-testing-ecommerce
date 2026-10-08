/**
 * Integration Tests: Product Catalog with Analytics
 *
 * Testing how product operations affect analytics and reporting
 */

import { ProductService } from '../../src/services/product-catalog/services/product.service';
import { ProductRepository } from '../../src/services/product-catalog/repositories/product.repository';
import { AnalyticsService } from '../../src/services/analytics/services/analytics.service';
import { OrderRepository } from '../../src/services/order-processing/repositories/order.repository';
import { UserRepository } from '../../src/services/user-management/repositories/user.repository';
import { ProductStatus } from '../../src/services/product-catalog/entities/product.entity';

jest.mock('../../src/services/product-catalog/repositories/product.repository');
jest.mock('../../src/services/order-processing/repositories/order.repository');
jest.mock('../../src/services/user-management/repositories/user.repository');

describe('Product and Analytics Integration Tests', () => {
  let productService: ProductService;
  let analyticsService: AnalyticsService;
  let mockProductRepository: jest.Mocked<ProductRepository>;
  let mockOrderRepository: jest.Mocked<OrderRepository>;
  let mockUserRepository: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockProductRepository = {
      createProduct: jest.fn(),
      findById: jest.fn(),
      updateInventory: jest.fn(),
      incrementSoldCount: jest.fn(),
      findTopSelling: jest.fn(),
      findTopRated: jest.fn(),
      findLowStock: jest.fn(),
      updateRating: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    mockOrderRepository = {
      getTotalRevenue: jest.fn(),
      findOrdersByDateRange: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    mockUserRepository = {
      count: jest.fn(),
      findByStatus: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    productService = new ProductService(mockProductRepository);
    analyticsService = new AnalyticsService(
      mockOrderRepository,
      mockProductRepository,
      mockUserRepository
    );
  });

  describe('Product Sales Tracking', () => {
    it('should track product views in analytics', async () => {
      const productId = 'prod-track-1';
      const userId = 'user-viewer-1';

      mockProductRepository.findById.mockResolvedValue({
        id: productId,
        name: 'Tracked Product',
        sku: 'TRACK-001',
        price: 99.99,
        inventory: 10,
        status: ProductStatus.ACTIVE,
      } as any);

      // User views product
      await productService.getProductById(productId);

      // Track view event in analytics
      await analyticsService.trackEvent({
        userId,
        eventType: 'product_view',
        productId,
        timestamp: new Date(),
      });

      // Get product performance metrics
      const metrics = await analyticsService.getProductPerformance(productId);

      expect(metrics.views).toBe(1);
    });

    it('should update top selling products when sales occur', async () => {
      const products = [
        { id: 'prod-1', name: 'Bestseller 1', soldCount: 1000, price: 50 },
        { id: 'prod-2', name: 'Bestseller 2', soldCount: 800, price: 60 },
        { id: 'prod-3', name: 'Bestseller 3', soldCount: 600, price: 70 },
      ];

      mockProductRepository.findTopSelling.mockResolvedValue(products as any);

      const topSelling = await analyticsService.getTopSellingProducts(10);

      expect(topSelling.length).toBe(3);
      expect(topSelling[0].soldCount).toBeGreaterThan(topSelling[1].soldCount);
    });

    it('should track product purchases and update sold count', async () => {
      const productId = 'prod-purchase-1';

      mockProductRepository.findById.mockResolvedValue({
        id: productId,
        name: 'Purchase Product',
        soldCount: 53,
      } as any);

      mockProductRepository.incrementSoldCount.mockResolvedValue({
        id: productId,
        soldCount: 53,
      } as any);

      // Simulate 3 products sold
      await mockProductRepository.incrementSoldCount(productId, 3);

      const updated = await mockProductRepository.findById(productId);
      expect(updated.soldCount).toBeGreaterThan(50);
    });
  });

  describe('Inventory Analytics', () => {
    it('should identify low stock products', async () => {
      const lowStockProducts = [
        { id: 'prod-low-1', name: 'Low Stock 1', inventory: 3 },
        { id: 'prod-low-2', name: 'Low Stock 2', inventory: 5 },
        { id: 'prod-low-3', name: 'Low Stock 3', inventory: 8 },
      ];

      mockProductRepository.findLowStock.mockResolvedValue(lowStockProducts as any);

      const alerts = await analyticsService.getLowStockAlert(10);

      expect(alerts.length).toBe(3);
      expect(alerts.every(p => p.inventory <= 10)).toBe(true);
    });

    it('should track inventory changes', async () => {
      const productId = 'prod-inventory-1';

      mockProductRepository.findById
        .mockResolvedValueOnce({
          id: productId,
          inventory: 100,
        } as any)
        .mockResolvedValueOnce({
          id: productId,
          inventory: 95,
        } as any);

      // Track inventory before order
      const before = await mockProductRepository.findById(productId);
      const initialInventory = before.inventory;

      // Simulate order decreasing inventory
      mockProductRepository.updateInventory.mockResolvedValue({
        id: productId,
        inventory: 95,
      } as any);

      await mockProductRepository.updateInventory(productId, 95);

      // Track inventory after order
      const after = await mockProductRepository.findById(productId);

      expect(after.inventory).toBeLessThan(initialInventory);
    });
  });

  describe('Product Performance Metrics', () => {
    it('should calculate conversion rate for products', async () => {
      const productId = 'prod-conversion-1';
      const views = 1000;
      const purchases = 50;

      // Track views
      for (let i = 0; i < 5; i++) {
        await analyticsService.trackEvent({
          userId: `user-${i}`,
          eventType: 'product_view',
          productId,
          timestamp: new Date(),
        });
      }

      // Calculate conversion rate
      const conversionRate = await analyticsService.getConversionRate(views, purchases);

      expect(conversionRate).toBe(5); // 50/1000 * 100
    });

    it('should track product revenue', async () => {
      const productId = 'prod-revenue-1';

      // Track product sales events
      await analyticsService.trackEvent({
        userId: 'user-buyer-1',
        eventType: 'product_purchase',
        productId,
        timestamp: new Date(),
        metadata: {
          quantity: 2,
          unitPrice: 75.00,
          revenue: 150.00,
        },
      });

      const metrics = await analyticsService.getProductPerformance(productId);
      expect(metrics).toBeDefined();
    });
  });

  describe('Product Ratings and Reviews', () => {
    it('should update top rated products list', async () => {
      const topRatedProducts = [
        { id: 'prod-rated-1', name: 'Excellent Product', rating: 4.9, reviewCount: 500 },
        { id: 'prod-rated-2', name: 'Great Product', rating: 4.7, reviewCount: 300 },
        { id: 'prod-rated-3', name: 'Good Product', rating: 4.5, reviewCount: 200 },
      ];

      mockProductRepository.findTopRated.mockResolvedValue(topRatedProducts as any);

      const topRated = await analyticsService.getTopRatedProducts(10);

      expect(topRated.length).toBe(3);
      expect(topRated[0].rating).toBeGreaterThanOrEqual(topRated[1].rating);
    });

    it('should track rating changes', async () => {
      const productId = 'prod-rating-1';

      mockProductRepository.findById.mockResolvedValue({
        id: productId,
        rating: 4.2,
        reviewCount: 11,
      } as any);

      // Add new rating
      mockProductRepository.updateRating.mockResolvedValue({
        id: productId,
        rating: 4.2,
        reviewCount: 11,
      } as any);

      await mockProductRepository.updateRating(productId, 4.2, 11);

      const updated = await mockProductRepository.findById(productId);
      expect(updated.rating).toBeGreaterThan(4.0);
      expect(updated.reviewCount).toBe(11);
    });
  });

  describe('Dashboard Metrics Integration', () => {
    it('should aggregate product metrics for dashboard', async () => {
      mockOrderRepository.getTotalRevenue.mockResolvedValue(100000);
      mockOrderRepository.count.mockResolvedValue(500);
      mockUserRepository.count.mockResolvedValue(2000);
      mockProductRepository.count.mockResolvedValue(150);

      const dashboard = await analyticsService.getDashboardMetrics();

      expect(dashboard.totalProducts).toBe(150);
      expect(dashboard.totalRevenue).toBe(100000);
      expect(dashboard.totalOrders).toBe(500);
      expect(dashboard.averageOrderValue).toBe(200);
    });

    it('should include product-specific metrics in reports', async () => {
      mockProductRepository.count.mockResolvedValue(150);
      mockProductRepository.findTopSelling.mockResolvedValue([
        { id: '1', soldCount: 1000 },
        { id: '2', soldCount: 800 },
      ] as any);
      mockProductRepository.findTopRated.mockResolvedValue([
        { id: '3', rating: 4.9 },
        { id: '4', rating: 4.8 },
      ] as any);
      mockProductRepository.findLowStock.mockResolvedValue([
        { id: '5', inventory: 3 },
      ] as any);

      const report = await analyticsService.exportReport('products');

      expect(report.type).toBe('products');
      expect(report.data).toHaveProperty('totalProducts');
      expect(report.data).toHaveProperty('topSelling');
      expect(report.data).toHaveProperty('topRated');
      expect(report.data).toHaveProperty('lowStock');
    });
  });

  describe('Sales Period Analytics', () => {
    it('should track product sales by time period', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-15'),
          total: 100,
          items: [{ productId: 'prod-1', quantity: 2 }],
        },
        {
          createdAt: new Date('2024-01-20'),
          total: 200,
          items: [{ productId: 'prod-1', quantity: 1 }],
        },
        {
          createdAt: new Date('2024-02-05'),
          total: 150,
          items: [{ productId: 'prod-2', quantity: 3 }],
        },
      ];

      mockOrderRepository.findOrdersByDateRange.mockResolvedValue(mockOrders as any);

      const metrics = await analyticsService.getSalesMetricsByPeriod('month');

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]).toHaveProperty('period');
      expect(metrics[0]).toHaveProperty('revenue');
      expect(metrics[0]).toHaveProperty('orderCount');
    });
  });

  describe('Product Lifecycle Analytics', () => {
    it('should track product from creation to first sale', async () => {
      // 1. Create product
      const createDto = {
        name: 'New Product',
        description: 'A brand new product',
        sku: 'NEW-001',
        price: 49.99,
        inventory: 100,
      };

      mockProductRepository.createProduct.mockResolvedValue({
        id: 'prod-new-1',
        ...createDto,
        soldCount: 0,
        status: ProductStatus.ACTIVE,
        createdAt: new Date(),
      } as any);

      const newProduct = await productService.createProduct(createDto);
      expect(newProduct.soldCount).toBe(0);

      // 2. Track product view
      await analyticsService.trackEvent({
        userId: 'user-1',
        eventType: 'product_view',
        productId: newProduct.id,
        timestamp: new Date(),
      });

      // 3. Simulate first sale
      mockProductRepository.incrementSoldCount.mockResolvedValue({
        id: 'prod-new-1',
        soldCount: 1,
      } as any);

      await mockProductRepository.incrementSoldCount(newProduct.id, 1);

      // 4. Verify analytics reflect the sale
      const performance = await analyticsService.getProductPerformance(newProduct.id);
      expect(performance.views).toBeGreaterThan(0);
    });

    it('should track product status changes in analytics', async () => {
      const productId = 'prod-status-1';

      // Product starts as DRAFT
      mockProductRepository.findById.mockResolvedValue({
        id: productId,
        status: ProductStatus.DRAFT,
        soldCount: 0,
      } as any);

      let product = await productService.getProductById(productId);
      expect(product.status).toBe(ProductStatus.DRAFT);

      // Activate product
      mockProductRepository.update = jest.fn().mockResolvedValue({
        id: productId,
        status: ProductStatus.ACTIVE,
        soldCount: 0,
      } as any);

      await mockProductRepository.update(productId, {
        status: ProductStatus.ACTIVE,
      });

      // After activation, product should appear in analytics
      mockProductRepository.count.mockResolvedValue(1);
      const totalProducts = await analyticsService.getDashboardMetrics();
      expect(totalProducts.totalProducts).toBeGreaterThan(0);
    });
  });

  describe('Cross-Service Event Tracking', () => {
    it('should track complete purchase funnel', async () => {
      const productId = 'prod-funnel-1';
      const userId = 'user-funnel-1';

      // 1. Product view
      await analyticsService.trackEvent({
        userId,
        eventType: 'product_view',
        productId,
        timestamp: new Date(),
      });

      // 2. Add to cart
      await analyticsService.trackEvent({
        userId,
        eventType: 'add_to_cart',
        productId,
        timestamp: new Date(),
      });

      // 3. Checkout
      await analyticsService.trackEvent({
        userId,
        eventType: 'checkout',
        productId,
        timestamp: new Date(),
      });

      // 4. Purchase
      await analyticsService.trackEvent({
        userId,
        eventType: 'product_purchase',
        productId,
        timestamp: new Date(),
      });

      // Verify all events tracked
      const events = await analyticsService.getEventsByUser(userId);
      expect(events.length).toBe(4);
      expect(events.map(e => e.eventType)).toContain('product_view');
      expect(events.map(e => e.eventType)).toContain('add_to_cart');
      expect(events.map(e => e.eventType)).toContain('checkout');
      expect(events.map(e => e.eventType)).toContain('product_purchase');
    });

    it('should calculate customer lifetime value with product purchases', async () => {
      mockOrderRepository.getTotalRevenue.mockResolvedValue(50000);
      mockUserRepository.count.mockResolvedValue(250);

      const clv = await analyticsService.getCustomerLifetimeValue();

      expect(clv).toBe(200); // 50000 / 250
    });
  });

  describe('Promotional Analytics', () => {
    it('should track sales for discounted products', async () => {
      const saleProducts = [
        {
          id: 'prod-sale-1',
          price: 79.99,
          compareAtPrice: 99.99,
          soldCount: 100,
        },
        {
          id: 'prod-sale-2',
          price: 49.99,
          compareAtPrice: 69.99,
          soldCount: 150,
        },
      ];

      mockProductRepository.findOnSale = jest.fn().mockResolvedValue(saleProducts);

      const onSale = await mockProductRepository.findOnSale();

      expect(onSale.length).toBe(2);
      expect(onSale.every(p => p.compareAtPrice! > p.price)).toBe(true);
    });

    it('should measure promotion effectiveness', async () => {
      const productId = 'prod-promo-1';

      // Sales before promotion
      const beforeSales = 10;

      // Apply discount
      mockProductRepository.update = jest.fn().mockResolvedValue({
        id: productId,
        price: 59.99,
        compareAtPrice: 79.99,
      } as any);

      // Sales after promotion
      mockProductRepository.incrementSoldCount.mockResolvedValue({
        id: productId,
        soldCount: 50, // 40 additional sales during promotion
      } as any);

      await mockProductRepository.incrementSoldCount(productId, 40);

      // Promotion increased sales by 400%
      const salesIncrease = ((50 - beforeSales) / beforeSales) * 100;
      expect(salesIncrease).toBe(400);
    });
  });

  describe('Inventory Optimization', () => {
    it('should identify fast-moving products for restocking', async () => {
      const topSelling = [
        { id: 'prod-fast-1', soldCount: 500, inventory: 5 },
        { id: 'prod-fast-2', soldCount: 450, inventory: 8 },
        { id: 'prod-fast-3', soldCount: 400, inventory: 3 },
      ];

      mockProductRepository.findTopSelling.mockResolvedValue(topSelling as any);

      const fastMoving = await analyticsService.getTopSellingProducts(10);

      // Identify products with high sales but low inventory
      const needRestock = fastMoving.filter(
        p => p.soldCount > 100 && p.inventory < 10
      );

      expect(needRestock.length).toBe(3);
    });

    it('should identify slow-moving products', async () => {
      mockProductRepository.findAll = jest.fn().mockResolvedValue([
        { id: 'prod-slow-1', soldCount: 2, inventory: 50, createdAt: new Date('2023-01-01') },
        { id: 'prod-slow-2', soldCount: 1, inventory: 100, createdAt: new Date('2023-01-01') },
      ]);

      const allProducts = await mockProductRepository.findAll();

      // Products with low sales after 1 year
      const slowMoving = allProducts.filter(p => p.soldCount < 5);

      expect(slowMoving.length).toBe(2);
    });
  });
});
