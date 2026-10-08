/**
 * TDD Implementation: User Repository
 *
 * This implementation was created to pass the tests in user.repository.spec.ts
 * Following TDD principles:
 * - Tests were written first (RED)
 * - Minimal code was implemented to pass tests (GREEN)
 * - Code can be refactored while keeping tests green (REFACTOR)
 */

import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { BaseRepository } from '@libs/database';
import { NotFoundError, ConflictError, BadRequestError } from '@libs/errors';

export class UserRepository extends BaseRepository<User> {
  constructor(repository: Repository<User>) {
    super(repository);
  }

  /**
   * Find user by email (case-insensitive)
   * TDD: Implemented to pass findByEmail tests
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  /**
   * Check if email exists (case-insensitive)
   * TDD: Implemented to pass emailExists tests
   */
  async emailExists(email: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { email: email.toLowerCase() },
    });
    return count > 0;
  }

  /**
   * Create user with duplicate email check
   * TDD: Implemented to pass createUser tests
   */
  async createUser(userData: Partial<User>): Promise<User> {
    // Normalize email to lowercase
    const email = userData.email?.toLowerCase();

    // Check for duplicate email
    if (email && (await this.emailExists(email))) {
      throw new ConflictError('User with this email already exists');
    }

    const user = this.repository.create({
      ...userData,
      email,
    });

    return this.repository.save(user);
  }

  /**
   * Find users by role
   * TDD: Implemented to pass findByRole tests
   */
  async findByRole(role: UserRole): Promise<User[]> {
    return this.repository.find({
      where: { role },
    });
  }

  /**
   * Find users by status
   * TDD: Implemented to pass findByStatus tests
   */
  async findByStatus(status: UserStatus): Promise<User[]> {
    return this.repository.find({
      where: { status },
    });
  }

  /**
   * Update last login timestamp
   * TDD: Implemented to pass updateLastLogin tests
   */
  async updateLastLogin(userId: string): Promise<User> {
    const user = await this.findById(userId);

    const updated = this.repository.merge(user, {
      lastLoginAt: new Date(),
    });

    return this.repository.save(updated);
  }

  /**
   * Increment login attempts and lock account if needed
   * TDD: Implemented to pass incrementLoginAttempts tests
   */
  async incrementLoginAttempts(userId: string): Promise<User> {
    const user = await this.findById(userId);

    const newAttempts = user.loginAttempts + 1;
    const updateData: Partial<User> = {
      loginAttempts: newAttempts,
    };

    // Lock account for 30 minutes after 5 failed attempts
    if (newAttempts >= 5) {
      updateData.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }

    const updated = this.repository.merge(user, updateData);
    return this.repository.save(updated);
  }

  /**
   * Reset login attempts and unlock account
   * TDD: Implemented to pass resetLoginAttempts tests
   */
  async resetLoginAttempts(userId: string): Promise<User> {
    const user = await this.findById(userId);

    const updated = this.repository.merge(user, {
      loginAttempts: 0,
      lockedUntil: null,
    });

    return this.repository.save(updated);
  }

  /**
   * Set email verification token
   * TDD: Implemented to pass setEmailVerificationToken tests
   */
  async setEmailVerificationToken(userId: string, token: string): Promise<User> {
    const user = await this.findById(userId);

    const updated = this.repository.merge(user, {
      emailVerificationToken: token,
    });

    return this.repository.save(updated);
  }

  /**
   * Verify email using token
   * TDD: Implemented to pass verifyEmail tests
   */
  async verifyEmail(token: string): Promise<User> {
    const user = await this.repository.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundError('Invalid verification token');
    }

    const updated = this.repository.merge(user, {
      emailVerificationToken: null,
      emailVerifiedAt: new Date(),
      status: UserStatus.ACTIVE,
    });

    return this.repository.save(updated);
  }

  /**
   * Set password reset token with expiry
   * TDD: Implemented to pass setPasswordResetToken tests
   */
  async setPasswordResetToken(userId: string, token: string): Promise<User> {
    const user = await this.findById(userId);

    const updated = this.repository.merge(user, {
      passwordResetToken: token,
      passwordResetExpires: new Date(Date.now() + 3600000), // 1 hour
    });

    return this.repository.save(updated);
  }

  /**
   * Reset password using token
   * TDD: Implemented to pass resetPassword tests
   */
  async resetPassword(token: string, newPassword: string): Promise<User> {
    const user = await this.repository.findOne({
      where: { passwordResetToken: token },
    });

    if (!user) {
      throw new NotFoundError('Invalid password reset token');
    }

    // Check if token is expired
    if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
      throw new BadRequestError('Password reset token has expired');
    }

    const updated = this.repository.merge(user, {
      password: newPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    });

    return this.repository.save(updated);
  }
}
