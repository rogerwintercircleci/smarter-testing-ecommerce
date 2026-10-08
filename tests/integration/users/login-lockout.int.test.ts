import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { RecordingNotifier } from '../support/fakes';
import { User, UserStatus } from '../../../src/services/user-management/entities/user.entity';
import { UserRepository } from '../../../src/services/user-management/repositories/user.repository';
import { UserService } from '../../../src/services/user-management/services/user.service';
import { verifyAccessToken, verifyRefreshToken } from '../../../src/libs/auth/jwt.utils';
import { UnauthorizedError } from '../../../src/libs/errors';

const PASSWORD = 'C0rrect!Horse';
const WRONG = 'Wr0ng!Horse';
const THIRTY_MINUTES = 30 * 60 * 1000;

describe('Login and account lockout (UserService + UserRepository, real Postgres)', () => {
  let ds: DataSource;
  let users: UserRepository;
  let service: UserService;
  let notifier: RecordingNotifier;

  beforeAll(async () => {
    ds = await createTestDatabase();
    users = new UserRepository(ds.getRepository(User));
  });

  afterAll(async () => {
    await dropTestDatabase(ds);
  });

  beforeEach(async () => {
    await truncateAll(ds);
    notifier = new RecordingNotifier();
    service = new UserService(users, notifier);
  });

  /** Register through the service and complete email verification. */
  async function verifiedUser(email: string): Promise<User> {
    await service.register({ email, password: PASSWORD, firstName: 'Test', lastName: 'User' });
    const token = notifier.lastTokenFor(email, 'verification');
    return service.verifyEmail(token!);
  }

  it('issues valid access and refresh tokens and records the login', async () => {
    const user = await verifiedUser('login@example.com');

    const result = await service.login({ email: 'login@example.com', password: PASSWORD });

    expect(result.token).toBe(result.accessToken);
    const access = verifyAccessToken(result.accessToken);
    const refresh = verifyRefreshToken(result.refreshToken);
    expect(access).toMatchObject({ userId: user.id, email: 'login@example.com', role: 'customer' });
    expect(refresh.userId).toBe(user.id);

    const stored = await users.findById(user.id);
    expect(stored.lastLoginAt).toBeInstanceOf(Date);
    expect(stored.loginAttempts).toBe(0);
  });

  it('accepts the (email, password) signature and a differently-cased email', async () => {
    await verifiedUser('casing@example.com');
    const result = await service.login('CaSiNg@Example.com', PASSWORD);
    expect(result.user.email).toBe('casing@example.com');
  });

  it('rejects an unknown email with a generic error', async () => {
    await expect(service.login('nobody@example.com', PASSWORD)).rejects.toThrow(
      new UnauthorizedError('Invalid credentials')
    );
  });

  it('counts each failed password attempt in the database', async () => {
    const user = await verifiedUser('count@example.com');

    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect(service.login('count@example.com', WRONG)).rejects.toThrow('Invalid credentials');
      expect((await users.findById(user.id)).loginAttempts).toBe(attempt);
    }
  });

  it('locks the account for 30 minutes after five failures, even for the right password', async () => {
    const user = await verifiedUser('lock@example.com');

    const before = Date.now();
    for (let i = 0; i < 5; i++) {
      await expect(service.login('lock@example.com', WRONG)).rejects.toThrow('Invalid credentials');
    }
    const after = Date.now();

    const stored = await users.findById(user.id);
    expect(stored.loginAttempts).toBe(5);
    expect(stored.lockedUntil!.getTime()).toBeGreaterThanOrEqual(before + THIRTY_MINUTES - 1000);
    expect(stored.lockedUntil!.getTime()).toBeLessThanOrEqual(after + THIRTY_MINUTES + 1000);
    expect(stored.isLocked()).toBe(true);

    await expect(service.login('lock@example.com', PASSWORD)).rejects.toThrow('Account is locked');
  });

  it('allows login again once the lock has expired and clears the failure counter', async () => {
    const user = await verifiedUser('expired-lock@example.com');
    for (let i = 0; i < 5; i++) {
      await expect(service.login('expired-lock@example.com', WRONG)).rejects.toThrow();
    }

    await users.update(user.id, { lockedUntil: new Date('2020-01-01T00:00:00Z') });

    await service.login('expired-lock@example.com', PASSWORD);
    expect((await users.findById(user.id)).loginAttempts).toBe(0);
  });

  it('resets the failure counter after a successful login', async () => {
    const user = await verifiedUser('reset-count@example.com');
    for (let i = 0; i < 4; i++) {
      await expect(service.login('reset-count@example.com', WRONG)).rejects.toThrow();
    }

    await service.login('reset-count@example.com', PASSWORD);
    expect((await users.findById(user.id)).loginAttempts).toBe(0);

    // The next failure starts counting from scratch rather than locking.
    await expect(service.login('reset-count@example.com', WRONG)).rejects.toThrow('Invalid credentials');
    const stored = await users.findById(user.id);
    expect(stored.loginAttempts).toBe(1);
    expect(stored.lockedUntil).toBeNull();
  });

  it('locks only the account under attack', async () => {
    const victim = await verifiedUser('victim@example.com');
    const bystander = await verifiedUser('bystander@example.com');

    for (let i = 0; i < 5; i++) {
      await expect(service.login('victim@example.com', WRONG)).rejects.toThrow();
    }

    expect((await users.findById(victim.id)).isLocked()).toBe(true);
    const other = await users.findById(bystander.id);
    expect(other.loginAttempts).toBe(0);
    await expect(service.login('bystander@example.com', PASSWORD)).resolves.toHaveProperty('accessToken');
  });

  it('refuses login until the email address is verified', async () => {
    await service.register({ email: 'unverified@example.com', password: PASSWORD, firstName: 'U', lastName: 'V' });
    await expect(service.login('unverified@example.com', PASSWORD)).rejects.toThrow(
      'Please verify your email before logging in'
    );
  });

  it('refuses suspended and deleted accounts', async () => {
    const suspended = await verifiedUser('suspended@example.com');
    const deleted = await verifiedUser('deleted@example.com');
    await users.update(suspended.id, { status: UserStatus.SUSPENDED });
    await users.update(deleted.id, { status: UserStatus.DELETED });

    await expect(service.login('suspended@example.com', PASSWORD)).rejects.toThrow('Account is suspended');
    await expect(service.login('deleted@example.com', PASSWORD)).rejects.toThrow('Account has been deleted');
  });

  it('treats a soft-deleted user as unknown', async () => {
    const user = await verifiedUser('soft@example.com');
    await users.softDelete(user.id);

    expect(await users.findByEmail('soft@example.com')).toBeNull();
    await expect(service.login('soft@example.com', PASSWORD)).rejects.toThrow('Invalid credentials');
  });

  it('refreshes an access token only for active accounts', async () => {
    const user = await verifiedUser('refresh@example.com');
    const { refreshToken } = await service.login('refresh@example.com', PASSWORD);

    const { accessToken } = await service.refreshToken(refreshToken);
    expect(verifyAccessToken(accessToken).userId).toBe(user.id);

    await users.update(user.id, { status: UserStatus.SUSPENDED });
    await expect(service.refreshToken(refreshToken)).rejects.toThrow('Account is not active');
    await expect(service.refreshToken('not-a-jwt')).rejects.toThrow('Invalid refresh token');
  });
});
