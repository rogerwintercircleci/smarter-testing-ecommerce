/**
 * Integration Tests: User Authentication Flow
 *
 * Testing complete authentication workflows across services
 */

import { UserService } from '../../src/services/user-management/services/user.service';
import { UserRepository } from '../../src/services/user-management/repositories/user.repository';
import { NotificationService } from '../../src/services/notifications/services/notification.service';
import { hashPassword } from '../../src/libs/auth/password.utils';
import { verifyToken } from '../../src/libs/auth/jwt.utils';
import { UnauthorizedError, BadRequestError } from '../../src/libs/errors';

jest.mock('../../src/services/user-management/repositories/user.repository');
jest.mock('../../src/services/notifications/services/notification.service');

describe('User Authentication Integration Tests', () => {
  let userService: UserService;
  let mockUserRepository: jest.Mocked<UserRepository>;
  let mockNotificationService: jest.Mocked<NotificationService>;

  beforeEach(() => {
    mockUserRepository = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
      update: jest.fn(),
      setEmailVerificationToken: jest.fn(),
      verifyEmail: jest.fn(),
      setPasswordResetToken: jest.fn(),
      resetPassword: jest.fn(),
      updateLastLogin: jest.fn(),
      incrementLoginAttempts: jest.fn(),
      resetLoginAttempts: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    mockNotificationService = {
      sendWelcomeEmail: jest.fn(),
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    } as unknown as jest.Mocked<NotificationService>;

    userService = new UserService(mockUserRepository, mockNotificationService);
  });

  describe('Complete Registration Flow', () => {
    it('should register user and send verification email', async () => {
      const registerDto = {
        email: 'newuser@test.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
      };

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.createUser.mockResolvedValue({
        id: 'user-123',
        email: 'newuser@test.com',
        firstName: 'New',
        lastName: 'User',
        emailVerifiedAt: null,
        emailVerificationToken: 'verify-token-123',
      } as any);
      mockNotificationService.sendWelcomeEmail.mockResolvedValue({ success: true });
      mockNotificationService.sendVerificationEmail.mockResolvedValue({ success: true });

      const result = await userService.register(registerDto);

      expect(result.user.email).toBe('newuser@test.com');
      expect(mockNotificationService.sendWelcomeEmail).toHaveBeenCalledWith(
        'newuser@test.com',
        'New',
        'user-123'
      );
      expect(mockNotificationService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should hash password during registration', async () => {
      const registerDto = {
        email: 'secure@test.com',
        password: 'PlainPassword123!',
        firstName: 'Secure',
        lastName: 'User',
      };

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.createUser.mockImplementation(async (userData) => {
        // Verify password is hashed
        expect(userData.password).not.toBe('PlainPassword123!');
        expect(userData.password?.startsWith('$2')).toBe(true); // bcrypt hash
        return { id: 'user-456', ...userData } as any;
      });
      mockNotificationService.sendWelcomeEmail.mockResolvedValue({ success: true });
      mockNotificationService.sendVerificationEmail.mockResolvedValue({ success: true });

      await userService.register(registerDto);

      expect(mockUserRepository.createUser).toHaveBeenCalled();
    });

    it('should reject weak passwords', async () => {
      const registerDto = {
        email: 'weak@test.com',
        password: 'weak',
        firstName: 'Weak',
        lastName: 'Password',
      };

      await expect(userService.register(registerDto)).rejects.toThrow(BadRequestError);
      expect(mockUserRepository.createUser).not.toHaveBeenCalled();
    });
  });

  describe('Email Verification Flow', () => {
    it('should verify email and activate account', async () => {
      const token = 'verify-token-456';

      mockUserRepository.verifyEmail.mockResolvedValue({
        id: 'user-789',
        email: 'verified@test.com',
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        status: 'active',
      } as any);

      const result = await userService.verifyEmail(token);

      expect(result.emailVerifiedAt).toBeDefined();
      expect(result.status).toBe('active');
      expect(mockUserRepository.verifyEmail).toHaveBeenCalledWith(token);
    });

    it('should reject invalid verification token', async () => {
      mockUserRepository.verifyEmail.mockRejectedValue(
        new UnauthorizedError('Invalid verification token')
      );

      await expect(userService.verifyEmail('invalid-token')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  describe('Login Flow', () => {
    it('should login user with correct credentials', async () => {
      const hashedPassword = await hashPassword('CorrectPass123!');

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-login-1',
        email: 'login@test.com',
        password: hashedPassword,
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 0,
        lockedUntil: null,
      } as any);
      mockUserRepository.updateLastLogin.mockResolvedValue({} as any);
      mockUserRepository.resetLoginAttempts.mockResolvedValue({} as any);

      const result = await userService.login('login@test.com', 'CorrectPass123!');

      expect(result.token).toBeDefined();
      expect(result.user.email).toBe('login@test.com');
      expect(mockUserRepository.updateLastLogin).toHaveBeenCalled();
      expect(mockUserRepository.resetLoginAttempts).toHaveBeenCalled();
    });

    it('should reject login with incorrect password', async () => {
      const hashedPassword = await hashPassword('CorrectPass123!');

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-login-2',
        email: 'login@test.com',
        password: hashedPassword,
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 0,
      } as any);
      mockUserRepository.incrementLoginAttempts.mockResolvedValue({
        loginAttempts: 1,
      } as any);

      await expect(
        userService.login('login@test.com', 'WrongPassword')
      ).rejects.toThrow(UnauthorizedError);

      expect(mockUserRepository.incrementLoginAttempts).toHaveBeenCalled();
    });

    it('should lock account after 5 failed login attempts', async () => {
      const hashedPassword = await hashPassword('CorrectPass123!');

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-login-3',
        email: 'lockme@test.com',
        password: hashedPassword,
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 4, // Already 4 failed attempts
      } as any);

      const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      mockUserRepository.incrementLoginAttempts.mockResolvedValue({
        loginAttempts: 5,
        lockedUntil,
      } as any);

      await expect(
        userService.login('lockme@test.com', 'WrongPassword')
      ).rejects.toThrow(UnauthorizedError);

      expect(mockUserRepository.incrementLoginAttempts).toHaveBeenCalled();
    });

    it('should prevent login for locked account', async () => {
      const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-locked',
        email: 'locked@test.com',
        password: await hashPassword('Pass123!'),
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 5,
        lockedUntil,
      } as any);

      await expect(
        userService.login('locked@test.com', 'Pass123!')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should require email verification before login', async () => {
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-unverified',
        email: 'unverified@test.com',
        password: await hashPassword('Pass123!'),
        emailVerifiedAt: null,
        status: 'pending',
      } as any);

      await expect(
        userService.login('unverified@test.com', 'Pass123!')
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('Password Reset Flow', () => {
    it('should initiate password reset and send email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-reset-1',
        email: 'reset@test.com',
      } as any);
      mockUserRepository.setPasswordResetToken.mockResolvedValue({} as any);
      mockNotificationService.sendPasswordResetEmail.mockResolvedValue({
        success: true,
      });

      await userService.requestPasswordReset('reset@test.com');

      expect(mockUserRepository.setPasswordResetToken).toHaveBeenCalled();
      expect(mockNotificationService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'reset@test.com',
        expect.any(String)
      );
    });

    it('should complete password reset with valid token', async () => {
      const resetToken = 'reset-token-789';
      const newPassword = 'NewSecurePass123!';

      mockUserRepository.resetPassword.mockResolvedValue({
        id: 'user-reset-2',
        email: 'reset2@test.com',
        passwordResetToken: null,
        passwordResetExpires: null,
      } as any);

      const result = await userService.resetPassword(resetToken, newPassword);

      expect(result.passwordResetToken).toBeNull();
      expect(mockUserRepository.resetPassword).toHaveBeenCalledWith(
        resetToken,
        expect.any(String) // hashed password
      );
    });

    it('should reject weak password in reset', async () => {
      await expect(
        userService.resetPassword('token', 'weak')
      ).rejects.toThrow(BadRequestError);
    });

    it('should not reveal if email exists', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      // Should not throw error even if email doesn't exist
      await expect(
        userService.requestPasswordReset('nonexistent@test.com')
      ).resolves.not.toThrow();
    });
  });

  describe('JWT Token Operations', () => {
    it('should generate valid JWT token on login', async () => {
      const hashedPassword = await hashPassword('TokenTest123!');

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-jwt-1',
        email: 'jwt@test.com',
        password: hashedPassword,
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 0,
      } as any);
      mockUserRepository.updateLastLogin.mockResolvedValue({} as any);
      mockUserRepository.resetLoginAttempts.mockResolvedValue({} as any);

      const result = await userService.login('jwt@test.com', 'TokenTest123!');

      expect(result.token).toBeDefined();

      // Verify token can be decoded
      const decoded = verifyToken(result.token);
      expect(decoded.userId).toBe('user-jwt-1');
      expect(decoded.email).toBe('jwt@test.com');
    });

    it('should include user role in token', async () => {
      const hashedPassword = await hashPassword('AdminTest123!');

      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        password: hashedPassword,
        emailVerifiedAt: new Date(),
        status: 'active',
        role: 'admin',
        loginAttempts: 0,
      } as any);
      mockUserRepository.updateLastLogin.mockResolvedValue({} as any);
      mockUserRepository.resetLoginAttempts.mockResolvedValue({} as any);

      const result = await userService.login('admin@test.com', 'AdminTest123!');

      const decoded = verifyToken(result.token);
      expect(decoded.role).toBe('admin');
    });
  });

  describe('Account Status Validation', () => {
    it('should prevent login for suspended account', async () => {
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-suspended',
        email: 'suspended@test.com',
        password: await hashPassword('Pass123!'),
        emailVerifiedAt: new Date(),
        status: 'suspended',
      } as any);

      await expect(
        userService.login('suspended@test.com', 'Pass123!')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should prevent login for deleted account', async () => {
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-deleted',
        email: 'deleted@test.com',
        password: await hashPassword('Pass123!'),
        emailVerifiedAt: new Date(),
        status: 'deleted',
        deletedAt: new Date(),
      } as any);

      await expect(
        userService.login('deleted@test.com', 'Pass123!')
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('Multi-step Authentication Flows', () => {
    it('should handle complete user lifecycle', async () => {
      // 1. Registration
      const registerDto = {
        email: 'lifecycle@test.com',
        password: 'LifeCycle123!',
        firstName: 'Life',
        lastName: 'Cycle',
      };

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.createUser.mockResolvedValue({
        id: 'user-lifecycle',
        email: 'lifecycle@test.com',
        emailVerificationToken: 'verify-token',
        emailVerifiedAt: null,
        status: 'pending',
      } as any);
      mockNotificationService.sendWelcomeEmail.mockResolvedValue({ success: true });
      mockNotificationService.sendVerificationEmail.mockResolvedValue({
        success: true,
      });

      const registered = await userService.register(registerDto);
      expect(registered.user.status).toBe('pending');

      // 2. Email Verification
      mockUserRepository.verifyEmail.mockResolvedValue({
        id: 'user-lifecycle',
        email: 'lifecycle@test.com',
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        status: 'active',
        password: await hashPassword('LifeCycle123!'),
        loginAttempts: 0,
      } as any);

      const verified = await userService.verifyEmail('verify-token');
      expect(verified.status).toBe('active');

      // 3. Login
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'user-lifecycle',
        email: 'lifecycle@test.com',
        password: await hashPassword('LifeCycle123!'),
        emailVerifiedAt: new Date(),
        status: 'active',
        loginAttempts: 0,
      } as any);
      mockUserRepository.updateLastLogin.mockResolvedValue({} as any);
      mockUserRepository.resetLoginAttempts.mockResolvedValue({} as any);

      const loggedIn = await userService.login('lifecycle@test.com', 'LifeCycle123!');
      expect(loggedIn.token).toBeDefined();
    });
  });
});
