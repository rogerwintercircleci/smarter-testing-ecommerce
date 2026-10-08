/**
 * Inventory Management Service Implementation
 */

import { InventoryRepository } from '../repositories/inventory.repository';
import { ProductRepository } from '../../product-catalog/repositories/product.repository';
import { Inventory } from '../entities/inventory.entity';
import { BadRequestError, ConflictError } from '@libs/errors';

export interface AdjustInventoryDto {
  productId: string;
  quantity: number;
  reason: string;
  userId?: string;
}

export interface ReservationDto {
  productId: string;
  quantity: number;
  orderId: string;
  expirationMinutes?: number;
}

export class InventoryService {
  private readonly DEFAULT_RESERVATION_MINUTES = 15;

  constructor(
    private inventoryRepository: InventoryRepository,
    private productRepository: ProductRepository
  ) {}

  async getStock(productId: string) {
    const inventory = await this.inventoryRepository.findByProductId(productId);
    return {
      ...inventory,
      available: inventory.quantity - (inventory.reserved || 0),
    };
  }

  async adjustInventory(data: AdjustInventoryDto) {
    const inventory = await this.inventoryRepository.findByProductId(data.productId);

    const newQuantity = inventory.quantity + data.quantity;

    if (newQuantity < 0) {
      throw new BadRequestError('Insufficient inventory');
    }

    const updated = await this.inventoryRepository.update(data.productId, {
      quantity: newQuantity,
    });

    // Record adjustment in history
    await this.inventoryRepository.recordAdjustment({
      productId: data.productId,
      quantity: data.quantity,
      reason: data.reason,
      userId: data.userId,
      date: new Date(),
    });

    return updated;
  }

  async reserveStock(data: ReservationDto) {
    const inventory = await this.inventoryRepository.findByProductId(data.productId);
    const available = inventory.quantity - (inventory.reserved || 0);

    if (available < data.quantity) {
      throw new ConflictError('Insufficient stock available');
    }

    const expirationMinutes = data.expirationMinutes || this.DEFAULT_RESERVATION_MINUTES;
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    return this.inventoryRepository.createReservation({
      ...data,
      expiresAt,
    });
  }

  async releaseReservation(reservationId: string) {
    await this.inventoryRepository.findReservation(reservationId);
    await this.inventoryRepository.releaseReservation(reservationId);
  }

  async confirmReservation(reservationId: string) {
    const reservation = await this.inventoryRepository.findReservation(reservationId);

    // Releasing the reservation already removes its quantity from `reserved`,
    // so only the on-hand quantity is decremented here.
    await this.inventoryRepository.releaseReservation(reservationId);

    const inventory = await this.inventoryRepository.findByProductId(reservation.productId);
    return this.inventoryRepository.update(reservation.productId, {
      quantity: inventory.quantity - reservation.quantity,
    });
  }

  async checkAvailability(productId: string, quantity: number) {
    const inventory = await this.inventoryRepository.findByProductId(productId);
    const available = inventory.quantity - (inventory.reserved || 0);
    return available >= quantity;
  }

  async getLowStockProducts(options?: { threshold?: number }): Promise<Array<Inventory & { stockPercentage?: number }>> {
    const lowStock = await this.inventoryRepository.findLowStock();

    if (options?.threshold !== undefined) {
      const threshold = options.threshold;
      return lowStock.filter(item => {
        const percentage = (item.quantity / item.minStockLevel) * 100;
        return percentage <= threshold;
      }).map(item => ({
        ...item,
        stockPercentage: (item.quantity / item.minStockLevel) * 100,
      }));
    }

    return lowStock;
  }

  async getOutOfStockProducts(): Promise<Inventory[]> {
    return this.inventoryRepository.findOutOfStock();
  }

  async setMinStockLevel(productId: string, minStockLevel: number) {
    if (minStockLevel < 0) {
      throw new BadRequestError('Minimum stock level cannot be negative');
    }

    await this.inventoryRepository.findByProductId(productId);

    return this.inventoryRepository.update(productId, {
      minStockLevel,
    });
  }

  async setReorderPoint(productId: string, reorderPoint: number, reorderQuantity: number) {
    await this.inventoryRepository.findByProductId(productId);

    return this.inventoryRepository.update(productId, {
      reorderPoint,
      reorderQuantity,
    });
  }

  async getInventoryHistory(productId: string, options?: any) {
    return this.inventoryRepository.getInventoryHistory(productId, options);
  }

  async releaseExpiredReservations() {
    const expired = await this.inventoryRepository.findExpiredReservations();

    for (const reservation of expired) {
      await this.inventoryRepository.releaseReservation(reservation.id);
    }

    return {
      releasedCount: expired.length,
    };
  }

  async getStockValue(productId: string) {
    const inventory = await this.inventoryRepository.findByProductId(productId);
    const product = await this.productRepository.findById(productId);

    return inventory.quantity * product.price;
  }

  async bulkUpdateInventory(updates: Array<{ productId: string; quantity: number }>) {
    let updated = 0;
    let failed = 0;

    for (const update of updates) {
      try {
        await this.adjustInventory({
          productId: update.productId,
          quantity: update.quantity,
          reason: 'bulk_update',
        });
        updated++;
      } catch (error) {
        failed++;
      }
    }

    return { updated, failed };
  }

  async getInventoryTurnover(productId: string, days: number) {
    const history = await this.inventoryRepository.getInventoryHistory(productId);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const sales = history.filter(h => h.date >= cutoff && h.quantity < 0);
    const totalSold = Math.abs(sales.reduce((sum, h) => sum + h.quantity, 0));

    const inventory = await this.inventoryRepository.findByProductId(productId);
    const turnoverRate = inventory.quantity > 0 ? totalSold / inventory.quantity : 0;

    return {
      totalSold,
      averageInventory: inventory.quantity,
      turnoverRate,
    };
  }

  async predictRestockDate(productId: string) {
    const inventory = await this.inventoryRepository.findByProductId(productId);
    const history = await this.inventoryRepository.getInventoryHistory(productId);

    // Calculate daily average sales
    const sales = history.filter(h => h.quantity < 0);
    const totalSold = Math.abs(sales.reduce((sum, h) => sum + h.quantity, 0));
    const avgDailySales = totalSold / 30; // Last 30 days

    const daysUntilReorder = (inventory.quantity - inventory.reorderPoint) / avgDailySales;

    const restockDate = new Date();
    restockDate.setDate(restockDate.getDate() + Math.ceil(daysUntilReorder));

    return {
      estimatedDays: Math.ceil(daysUntilReorder),
      restockDate,
    };
  }

  async transferStock(transferDto: any) {
    // Record deduction from source
    await this.inventoryRepository.recordAdjustment({
      productId: transferDto.productId,
      quantity: -transferDto.quantity,
      reason: `transfer_to_${transferDto.toLocation}`,
      date: new Date(),
    });

    // Record addition to destination
    await this.inventoryRepository.recordAdjustment({
      productId: transferDto.productId,
      quantity: transferDto.quantity,
      reason: `transfer_from_${transferDto.fromLocation}`,
      date: new Date(),
    });
  }
}
