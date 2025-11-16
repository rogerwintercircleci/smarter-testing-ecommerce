/**
 * TDD: Notification Service Tests
 *
 * Testing email, SMS, and webhook notifications
 */

import { NotificationService } from './notification.service';
import { EmailProvider } from '../providers/email.provider';
import { SMSProvider } from '../providers/sms.provider';
import { WebhookProvider } from '../providers/webhook.provider';

jest.mock('../providers/email.provider');
jest.mock('../providers/sms.provider');
jest.mock('../providers/webhook.provider');

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let mockEmailProvider: jest.Mocked<EmailProvider>;
  let mockSMSProvider: jest.Mocked<SMSProvider>;
  let mockWebhookProvider: jest.Mocked<WebhookProvider>;

  beforeEach(() => {
    mockEmailProvider = {
      sendEmail: jest.fn(),
    } as unknown as jest.Mocked<EmailProvider>;

    mockSMSProvider = {
      sendSMS: jest.fn(),
    } as unknown as jest.Mocked<SMSProvider>;

    mockWebhookProvider = {
      sendWebhook: jest.fn(),
    } as unknown as jest.Mocked<WebhookProvider>;

    notificationService = new NotificationService(
      mockEmailProvider,
      mockSMSProvider,
      mockWebhookProvider
    );
  });

  describe('sendWelcomeEmail', () => {
    it('should send welcome email successfully', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-123', success: true });

      const result = await notificationService.sendWelcomeEmail(
        'user@example.com',
        'John Doe'
      );

      expect(result.success).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Welcome to Our Platform!',
        template: 'welcome',
        data: { name: 'John Doe' },
      });
    });

    it('should reject invalid email', async () => {
      await expect(
        notificationService.sendWelcomeEmail('invalid-email', 'John')
      ).rejects.toThrow('Invalid email address');
    });

    it('should handle email provider failure', async () => {
      mockEmailProvider.sendEmail.mockRejectedValue(new Error('SMTP error'));

      const result = await notificationService.sendWelcomeEmail(
        'user@example.com',
        'John'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP error');
    });
  });

  describe('sendOrderConfirmation', () => {
    const orderData = {
      orderNumber: 'ORD-2024-001',
      customerEmail: 'customer@example.com',
      customerName: 'Jane Smith',
      total: 150.00,
      items: [
        { name: 'Product 1', quantity: 2, price: 50.00 },
        { name: 'Product 2', quantity: 1, price: 50.00 },
      ],
    };

    it('should send order confirmation email', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-456', success: true });

      const result = await notificationService.sendOrderConfirmation(orderData);

      expect(result.success).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: 'customer@example.com',
        subject: `Order Confirmation - ${orderData.orderNumber}`,
        template: 'order-confirmation',
        data: orderData,
      });
    });

    it('should include order details in email', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-456', success: true });

      await notificationService.sendOrderConfirmation(orderData);

      const emailCall = mockEmailProvider.sendEmail.mock.calls[0][0];
      expect(emailCall.data).toHaveProperty('orderNumber');
      expect(emailCall.data).toHaveProperty('total');
      expect(emailCall.data).toHaveProperty('items');
    });
  });

  describe('sendShippingNotification', () => {
    it('should send shipping notification email', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-789', success: true });

      const result = await notificationService.sendShippingNotification(
        'customer@example.com',
        'ORD-2024-001',
        'TRACK-123456'
      );

      expect(result.success).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: 'customer@example.com',
        subject: 'Your Order Has Shipped!',
        template: 'shipping-notification',
        data: {
          orderNumber: 'ORD-2024-001',
          trackingNumber: 'TRACK-123456',
        },
      });
    });

    it('should send SMS if phone number provided', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-789', success: true });
      mockSMSProvider.sendSMS.mockResolvedValue({ messageId: 'sms-123' });

      await notificationService.sendShippingNotification(
        'customer@example.com',
        'ORD-2024-001',
        'TRACK-123456',
        '+1234567890'
      );

      expect(mockSMSProvider.sendSMS).toHaveBeenCalledWith({
        to: '+1234567890',
        message: expect.stringContaining('shipped'),
      });
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email with token', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-reset', success: true });

      const result = await notificationService.sendPasswordResetEmail(
        'user@example.com',
        'reset-token-123'
      );

      expect(result.success).toBe(true);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Reset Your Password',
        template: 'password-reset',
        data: {
          resetToken: 'reset-token-123',
          resetLink: expect.stringContaining('reset-token-123'),
          expiresIn: '1 hour',
        },
      });
    });

    it('should include expiration time in email', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-reset', success: true });

      await notificationService.sendPasswordResetEmail(
        'user@example.com',
        'token'
      );

      const emailData = mockEmailProvider.sendEmail.mock.calls[0][0].data;
      expect(emailData).toHaveProperty('expiresIn');
    });
  });

  describe('sendSMSNotification', () => {
    it('should send SMS successfully', async () => {
      mockSMSProvider.sendSMS.mockResolvedValue({ messageId: 'sms-456' });

      const result = await notificationService.sendSMSNotification(
        '+1234567890',
        'Your order has been delivered!'
      );

      expect(result.success).toBe(true);
      expect(mockSMSProvider.sendSMS).toHaveBeenCalledWith({
        to: '+1234567890',
        message: 'Your order has been delivered!',
      });
    });

    it('should reject invalid phone number', async () => {
      await expect(
        notificationService.sendSMSNotification('invalid', 'message')
      ).rejects.toThrow('Invalid phone number format');
    });

    it('should reject message that is too long', async () => {
      const longMessage = 'a'.repeat(161);

      await expect(
        notificationService.sendSMSNotification('+1234567890', longMessage)
      ).rejects.toThrow('SMS message exceeds maximum length');
    });

    it('should handle SMS provider failure', async () => {
      mockSMSProvider.sendSMS.mockRejectedValue(new Error('SMS API error'));

      const result = await notificationService.sendSMSNotification(
        '+1234567890',
        'message'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('sendWebhook', () => {
    it('should send webhook notification', async () => {
      mockWebhookProvider.sendWebhook.mockResolvedValue({ statusCode: 200 });

      const payload = {
        event: 'order.created',
        data: { orderId: '123' },
      };

      const result = await notificationService.sendWebhook(
        'https://api.example.com/webhook',
        payload
      );

      expect(result.success).toBe(true);
      expect(mockWebhookProvider.sendWebhook).toHaveBeenCalledWith({
        url: 'https://api.example.com/webhook',
        payload,
      });
    });

    it('should reject invalid URL', async () => {
      await expect(
        notificationService.sendWebhook('not-a-url', {})
      ).rejects.toThrow('Invalid webhook URL');
    });

    it('should retry on failure', async () => {
      mockWebhookProvider.sendWebhook
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ statusCode: 200 });

      const result = await notificationService.sendWebhook(
        'https://api.example.com/webhook',
        { event: 'test' },
        { retries: 1 }
      );

      expect(result.success).toBe(true);
      expect(mockWebhookProvider.sendWebhook).toHaveBeenCalledTimes(2);
    });

    it('should give up after max retries', async () => {
      mockWebhookProvider.sendWebhook.mockRejectedValue(new Error('Timeout'));

      const result = await notificationService.sendWebhook(
        'https://api.example.com/webhook',
        { event: 'test' },
        { retries: 2 }
      );

      expect(result.success).toBe(false);
      expect(mockWebhookProvider.sendWebhook).toHaveBeenCalledTimes(3); // Original + 2 retries
    });
  });

  describe('sendBulkEmail', () => {
    it('should send email to multiple recipients', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'bulk-msg', success: true });

      const recipients = [
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ];

      const result = await notificationService.sendBulkEmail(
        recipients,
        'Newsletter',
        'Check out our new products!'
      );

      expect(result.success).toBe(true);
      expect(result.sent).toBe(3);
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledTimes(3);
    });

    it('should track failures in bulk send', async () => {
      mockEmailProvider.sendEmail
        .mockResolvedValueOnce({ messageId: 'msg-1', success: true })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ messageId: 'msg-3', success: true });

      const recipients = ['user1@example.com', 'user2@example.com', 'user3@example.com'];

      const result = await notificationService.sendBulkEmail(
        recipients,
        'Newsletter',
        'Content'
      );

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should reject empty recipient list', async () => {
      await expect(
        notificationService.sendBulkEmail([], 'Subject', 'Content')
      ).rejects.toThrow('Recipient list cannot be empty');
    });
  });

  describe('getUserPreferences', () => {
    it('should get notification preferences for user', async () => {
      const prefs = await notificationService.getUserPreferences('user-123');

      expect(prefs).toHaveProperty('email');
      expect(prefs).toHaveProperty('sms');
      expect(prefs).toHaveProperty('push');
    });

    it('should return default preferences for new user', async () => {
      const prefs = await notificationService.getUserPreferences('new-user');

      expect(prefs.email).toBe(true);
      expect(prefs.sms).toBe(false);
      expect(prefs.push).toBe(false);
    });
  });

  describe('updateUserPreferences', () => {
    it('should update notification preferences', async () => {
      const newPrefs = {
        email: true,
        sms: true,
        push: false,
      };

      const result = await notificationService.updateUserPreferences(
        'user-123',
        newPrefs
      );

      expect(result).toEqual(newPrefs);
    });

    it('should not send emails if disabled in preferences', async () => {
      await notificationService.updateUserPreferences('user-123', {
        email: false,
        sms: false,
        push: false,
      });

      const result = await notificationService.sendWelcomeEmail(
        'user@example.com',
        'John',
        'user-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email notifications disabled for user');
      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('scheduleNotification', () => {
    it('should schedule notification for future delivery', async () => {
      const scheduledFor = new Date(Date.now() + 3600000); // 1 hour from now

      const result = await notificationService.scheduleNotification({
        type: 'email',
        recipient: 'user@example.com',
        subject: 'Reminder',
        content: 'Your trial expires soon',
        scheduledFor,
      });

      expect(result.scheduled).toBe(true);
      expect(result.scheduledFor).toEqual(scheduledFor);
    });

    it('should reject past scheduled time', async () => {
      const pastDate = new Date(Date.now() - 3600000);

      await expect(
        notificationService.scheduleNotification({
          type: 'email',
          recipient: 'user@example.com',
          subject: 'Test',
          content: 'Test',
          scheduledFor: pastDate,
        })
      ).rejects.toThrow('Scheduled time must be in the future');
    });
  });

  describe('getNotificationHistory', () => {
    it('should return notification history for user', async () => {
      await notificationService.sendWelcomeEmail('user@example.com', 'John');

      const history = await notificationService.getNotificationHistory('user@example.com');

      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('type');
      expect(history[0]).toHaveProperty('sentAt');
      expect(history[0]).toHaveProperty('status');
    });

    it('should filter history by type', async () => {
      await notificationService.sendWelcomeEmail('user@example.com', 'John');

      const history = await notificationService.getNotificationHistory(
        'user@example.com',
        { type: 'email' }
      );

      expect(history.every(h => h.type === 'email')).toBe(true);
    });

    it('should limit history results', async () => {
      const history = await notificationService.getNotificationHistory(
        'user@example.com',
        { limit: 10 }
      );

      expect(history.length).toBeLessThanOrEqual(10);
    });
  });
});
