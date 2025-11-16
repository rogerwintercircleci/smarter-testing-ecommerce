/**
 * TDD Implementation: User Service
 *
 * Business logic layer for user management
 * Implements all functionality to pass tests in user.service.spec.ts
 */

import { UserRepository } from '../repositories/user.repository';
import { User, UserStatus } from '../entities/user.entity';
import {
  UnauthorizedError,
  BadRequestError,
} from '@libs/errors';
import {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
} from '@libs/auth/password.utils';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '@libs/auth/jwt.utils';
import { randomBytes } from 'crypto';

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  token: string; // Alias for accessToken
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

export class UserService {
  constructor(
    private userRepository: UserRepository,
    private notificationService?: any
  ) {}

  /**
   * Register new user
   * TDD: Implements registration tests
   */
  async register(data: RegisterDto): Promise<{ user: User }> {
    // Validate password strength
    const passwordValidation = validatePasswordStrength(data.password);
    if (!passwordValidation.valid) {
      throw new BadRequestError(passwordValidation.errors.join(', '));
    }

    // Hash password
    const hashedPassword = await hashPassword(data.password);

    // Generate email verification token
    const emailVerificationToken = this.generateToken();

    // Create user
    const user = await this.userRepository.createUser({
      email: data.email,
      password: hashedPassword,
      firstName: data.firstName,
      lastName: data.lastName,
      phoneNumber: data.phoneNumber,
      emailVerificationToken,
    });

    // Send emails if notification service is available
    if (this.notificationService) {
      await this.notificationService.sendWelcomeEmail(user.email, user.firstName, user.id);
      await this.notificationService.sendVerificationEmail(user.email, emailVerificationToken);
    }

    return { user };
  }

  /**
   * Login user
   * TDD: Implements login tests
   */
  async login(emailOrCredentials: string | LoginDto, password?: string): Promise<LoginResponse> {
    // Handle both signatures: login(email, password) and login({email, password})
    let credentials: LoginDto;
    if (typeof emailOrCredentials === 'string') {
      credentials = { email: emailOrCredentials, password: password! };
    } else {
      credentials = emailOrCredentials;
    }

    // Find user by email
    const user = await this.userRepository.findByEmail(credentials.email);

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account is locked');
    }

    // Check if account is suspended
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedError('Account is suspended');
    }

    // Check if account is deleted
    if (user.status === UserStatus.DELETED || user.deletedAt) {
      throw new UnauthorizedError('Account has been deleted');
    }

    // Verify password
    const isPasswordValid = await comparePassword(credentials.password, user.password);

    if (!isPasswordValid) {
      // Increment login attempts
      await this.userRepository.incrementLoginAttempts(user.id);
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if email is verified
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedError('Please verify your email before logging in');
    }

    // Reset login attempts on successful login
    await this.userRepository.resetLoginAttempts(user.id);

    // Update last login timestamp
    await this.userRepository.updateLastLogin(user.id);

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = generateRefreshToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user,
      accessToken,
      refreshToken,
      token: accessToken, // Alias for backward compatibility
    };
  }

  /**
   * Verify email with token
   * TDD: Implements verifyEmail tests
   */
  async verifyEmail(token: string): Promise<User> {
    return this.userRepository.verifyEmail(token);
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new BadRequestError('User not found');
    }

    if (user.emailVerifiedAt) {
      throw new BadRequestError('Email already verified');
    }

    // Generate new verification token
    const emailVerificationToken = this.generateToken();
    await this.userRepository.setEmailVerificationToken(user.id, emailVerificationToken);

    // Send verification email if notification service is available
    if (this.notificationService) {
      await this.notificationService.sendVerificationEmail(user.email, emailVerificationToken);
    }
  }

  /**
   * Request email change
   */
  async requestEmailChange(userId: string, newEmail: string): Promise<string> {
    // Verify user exists
    await this.userRepository.findById(userId);

    // Check if new email is already taken
    const existingUser = await this.userRepository.findByEmail(newEmail);
    if (existingUser && existingUser.id !== userId) {
      throw new BadRequestError('Email already in use');
    }

    // Generate verification token for new email
    const verificationToken = this.generateToken();

    // Store the pending email change (in production, would store in database)
    // For now, we'll use the emailVerificationToken field
    await this.userRepository.update(userId, {
      emailVerificationToken: verificationToken,
    });

    // Send verification email to new address if notification service is available
    if (this.notificationService) {
      await this.notificationService.sendVerificationEmail(newEmail, verificationToken);
    }

    return verificationToken;
  }

  /**
   * Verify new email with token
   */
  async verifyNewEmail(verificationToken: string): Promise<User> {
    // In a real implementation, we would look up the pending email change by token
    // For now, we'll just verify the token exists
    const user = await this.userRepository.verifyEmail(verificationToken);
    return user;
  }

  /**
   * Request password reset
   * TDD: Implements requestPasswordReset tests
   */
  async requestPasswordReset(email: string): Promise<User | null> {
    const user = await this.userRepository.findByEmail(email);

    // Don't reveal if email exists (security best practice)
    if (!user) {
      return null;
    }

    const resetToken = this.generateToken();
    await this.userRepository.setPasswordResetToken(user.id, resetToken);

    // Send password reset email if notification service is available
    if (this.notificationService) {
      await this.notificationService.sendPasswordResetEmail(user.email, resetToken);
    }

    return user;
  }

  /**
   * Reset password with token
   * TDD: Implements resetPassword tests
   */
  async resetPassword(token: string, newPassword: string): Promise<User> {
    // Validate new password
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new BadRequestError(passwordValidation.errors.join(', '));
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Reset password
    return this.userRepository.resetPassword(token, hashedPassword);
  }

  /**
   * Get user by ID
   * TDD: Implements getUserById tests
   */
  async getUserById(userId: string): Promise<User> {
    return this.userRepository.findById(userId);
  }

  /**
   * Update user profile
   * TDD: Implements updateProfile tests
   */
  async updateProfile(userId: string, data: UpdateProfileDto): Promise<User> {
    // Filter out sensitive fields that should not be updated directly
    const allowedFields: UpdateProfileDto = {
      firstName: data.firstName,
      lastName: data.lastName,
      phoneNumber: data.phoneNumber,
    };

    // Remove undefined values
    const updateData = Object.fromEntries(
      Object.entries(allowedFields).filter(([_, v]) => v !== undefined)
    );

    return this.userRepository.update(userId, updateData);
  }

  /**
   * Change password (requires old password)
   * TDD: Implements changePassword tests
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    // Get user
    const user = await this.userRepository.findById(userId);

    // Verify old password
    const isOldPasswordValid = await comparePassword(oldPassword, user.password);
    if (!isOldPasswordValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Validate new password
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new BadRequestError(passwordValidation.errors.join(', '));
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await this.userRepository.update(userId, { password: hashedPassword });
  }

  /**
   * Refresh access token
   * TDD: Implements refreshToken tests
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    // Ensure user still exists and is active
    const user = await this.userRepository.findById(payload.userId);

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError('Account is not active');
    }

    // Generate new access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken };
  }

  /**
   * Generate random token
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Get user's full name
   * Helper method for display purposes
   */
  getUserFullName(user: User): string {
    return `${user.firstName} ${user.lastName}`.trim();
  }

  /**
   * Get user's initials for avatar display
   */
  getUserInitials(user: User): string {
    const firstInitial = user.firstName?.charAt(0)?.toUpperCase() || '';
    const lastInitial = user.lastName?.charAt(0)?.toUpperCase() || '';
    return `${firstInitial}${lastInitial}`;
  }

  /**
   * Get user display name (prefers full name, falls back to email)
   * Returns formatted name for UI display
   */
  getUserDisplayName(user: User): string {
    const fullName = this.getUserFullName(user);
    return fullName || user.email;
  }
}
