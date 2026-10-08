import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  CUSTOMER = 'customer',
  VENDOR = 'vendor',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  email!: string;

  @Column()
  password!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status!: UserStatus;

  @Column({ nullable: true })
  phoneNumber?: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  emailVerificationToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  emailVerifiedAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  passwordResetToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  passwordResetExpires?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ default: 0 })
  loginAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  /**
   * Get full name
   */
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  /**
   * Check if email is verified
   */
  isEmailVerified(): boolean {
    return this.emailVerifiedAt !== null && this.emailVerifiedAt !== undefined;
  }

  /**
   * Check if account is locked
   */
  isLocked(): boolean {
    if (!this.lockedUntil) {
      return false;
    }
    return this.lockedUntil > new Date();
  }

  /**
   * Check if user is active
   */
  isActive(): boolean {
    return this.status === UserStatus.ACTIVE && !this.isLocked();
  }

  /**
   * Sanitize user data (remove sensitive fields)
   */
  toJSON(): Partial<User> {
    const { password, emailVerificationToken, passwordResetToken, ...sanitized } = this;
    return sanitized;
  }
}
