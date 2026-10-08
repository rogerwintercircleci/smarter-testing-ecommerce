import { Repository } from 'typeorm';
import { RefundRequest, RefundStatus, ReturnStatus } from '../entities/refund.entity';
import { BaseRepository } from '@libs/database';

export class RefundRepository extends BaseRepository<RefundRequest> {
  constructor(repository: Repository<RefundRequest>) {
    super(repository);
  }

  async findByOrderId(orderId: string): Promise<RefundRequest[]> {
    return this.repository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByUserId(userId: string): Promise<RefundRequest[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByTrackingNumber(trackingNumber: string): Promise<RefundRequest | null> {
    return this.repository.findOne({
      where: { returnTrackingNumber: trackingNumber },
    });
  }

  async findByStatus(status: RefundStatus): Promise<RefundRequest[]> {
    return this.repository.find({
      where: { status },
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: string, status: RefundStatus): Promise<RefundRequest> {
    await this.repository.update(id, { status, updatedAt: new Date() });
    return this.findById(id);
  }

  async updateReturnStatus(id: string, returnStatus: ReturnStatus): Promise<RefundRequest> {
    await this.repository.update(id, { returnStatus, updatedAt: new Date() });
    return this.findById(id);
  }

  async countByStatus(status: RefundStatus): Promise<number> {
    return this.repository.count({ where: { status } });
  }

  async getTotalRefundedAmount(startDate?: Date, endDate?: Date): Promise<number> {
    let query = this.repository
      .createQueryBuilder('refund')
      .select('SUM(refund.refundAmount)', 'total')
      .where('refund.status = :status', { status: RefundStatus.COMPLETED });

    if (startDate) {
      query = query.andWhere('refund.processedAt >= :startDate', { startDate });
    }

    if (endDate) {
      query = query.andWhere('refund.processedAt <= :endDate', { endDate });
    }

    const result = await query.getRawOne();
    return parseFloat(result.total) || 0;
  }
}
