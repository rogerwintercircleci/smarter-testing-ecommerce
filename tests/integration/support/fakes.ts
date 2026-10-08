/**
 * Hand-rolled fakes for external providers (email, payment gateway,
 * shipping carrier). The database and all src/ code stay real; only the
 * network edges are replaced.
 *
 * These are plain classes rather than jest.fn() because the shared Jest
 * config uses resetMocks, which would wipe implementations between tests.
 */
import type { PaymentGatewayService } from '../../../src/services/order-processing/services/payment-gateway.service';
import type { ShippingProviderService } from '../../../src/services/order-processing/services/shipping-provider.service';

export interface SentEmail {
  type: 'welcome' | 'verification' | 'password-reset';
  to: string;
  token?: string;
}

export class RecordingNotifier {
  readonly sent: SentEmail[] = [];

  async sendWelcomeEmail(to: string, _firstName: string, _userId: string): Promise<void> {
    this.sent.push({ type: 'welcome', to });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    this.sent.push({ type: 'verification', to, token });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    this.sent.push({ type: 'password-reset', to, token });
  }

  lastTokenFor(to: string, type: SentEmail['type']): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.type === type)?.token;
  }
}

export interface RefundCall {
  transactionId: string;
  amount: number;
  reason: string;
}

export class FakePaymentGateway {
  readonly refunds: RefundCall[] = [];
  failNext = false;

  async refundPayment(data: RefundCall) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Gateway timeout');
    }
    this.refunds.push(data);
    return {
      success: true,
      refundId: `rfnd_${this.refunds.length}`,
      status: 'completed',
      amount: data.amount,
      originalTransactionId: data.transactionId,
    };
  }

  asService(): PaymentGatewayService {
    return this as unknown as PaymentGatewayService;
  }
}

export class FakeShippingProvider {
  private labelCount = 0;
  readonly trackingStatus = new Map<string, string>();

  async createReturnLabel(request: { refundId: string }) {
    this.labelCount += 1;
    const trackingNumber = `RET${String(this.labelCount).padStart(8, '0')}`;
    return {
      success: true,
      trackingNumber,
      labelUrl: `https://labels.example.test/return/${request.refundId}.pdf`,
    };
  }

  async trackShipment(trackingNumber: string) {
    return {
      trackingNumber,
      carrier: 'TEST',
      status: this.trackingStatus.get(trackingNumber) ?? 'label_created',
      events: [],
    };
  }

  asService(): ShippingProviderService {
    return this as unknown as ShippingProviderService;
  }
}
