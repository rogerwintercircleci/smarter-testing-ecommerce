import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { RecordingNotifier } from '../support/fakes';
import { User, UserStatus } from '../../../src/services/user-management/entities/user.entity';
import { UserRepository } from '../../../src/services/user-management/repositories/user.repository';
import { UserService } from '../../../src/services/user-management/services/user.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

const PASSWORD = 'V3rify!Me';

describe('Email verification (UserService + UserRepository, real Postgres)', () => {
  let ds: DataSource;
  let users: UserRepository;
  let notifier: RecordingNotifier;
  let service: UserService;

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

  async function register(email: string): Promise<{ user: User; token: string }> {
    const { user } = await service.register({ email, password: PASSWORD, firstName: 'Eve', lastName: 'Ng' });
    return { user, token: notifier.lastTokenFor(email, 'verification')! };
  }

  it('activates the account and stamps emailVerifiedAt', async () => {
    const { user, token } = await register('verify@example.com');
    const before = Date.now();

    const verified = await service.verifyEmail(token);

    expect(verified.id).toBe(user.id);
    const stored = await users.findById(user.id);
    expect(stored.status).toBe(UserStatus.ACTIVE);
    expect(stored.isEmailVerified()).toBe(true);
    expect(stored.emailVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('consumes the verification token so it cannot be used again', async () => {
    const { user, token } = await register('once@example.com');

    await service.verifyEmail(token);

    expect((await users.findById(user.id)).emailVerificationToken).toBeNull();
    await expect(service.verifyEmail(token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an unknown verification token', async () => {
    await register('someone@example.com');
    await expect(service.verifyEmail('f'.repeat(64))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.verifyEmail('f'.repeat(64))).rejects.toThrow('Invalid verification token');
  });

  it('lets a newly verified user log in', async () => {
    const { token } = await register('then-login@example.com');
    await expect(service.login('then-login@example.com', PASSWORD)).rejects.toThrow(/verify your email/);

    await service.verifyEmail(token);

    await expect(service.login('then-login@example.com', PASSWORD)).resolves.toHaveProperty('accessToken');
  });

  it('verifies only the user that owns the token', async () => {
    const registered: Array<{ user: User; token: string }> = [];
    for (let i = 0; i < 12; i++) {
      registered.push(await register(`pending-${i}@example.com`));
    }

    await service.verifyEmail(registered[7].token);

    const active = await users.findByStatus(UserStatus.ACTIVE);
    expect(active.map((u) => u.id)).toEqual([registered[7].user.id]);
    expect(await users.findByStatus(UserStatus.PENDING)).toHaveLength(11);
  });

  it('resends verification with a fresh token that replaces the old one', async () => {
    const { user, token: original } = await register('resend@example.com');

    await service.resendVerificationEmail('RESEND@example.com');

    const fresh = notifier.lastTokenFor('resend@example.com', 'verification')!;
    expect(fresh).not.toBe(original);
    expect((await users.findById(user.id)).emailVerificationToken).toBe(fresh);
    await expect(service.verifyEmail(original)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.verifyEmail(fresh)).resolves.toHaveProperty('status', UserStatus.ACTIVE);
  });

  it('refuses to resend for unknown or already verified addresses', async () => {
    const { token } = await register('done@example.com');
    await service.verifyEmail(token);

    await expect(service.resendVerificationEmail('done@example.com')).rejects.toThrow(
      new BadRequestError('Email already verified')
    );
    await expect(service.resendVerificationEmail('ghost@example.com')).rejects.toThrow('User not found');
  });

  it('issues an email-change token and refuses addresses that belong to someone else', async () => {
    const { user, token } = await register('mover@example.com');
    await service.verifyEmail(token);
    await register('taken@example.com');

    await expect(service.requestEmailChange(user.id, 'taken@example.com')).rejects.toThrow(
      'Email already in use'
    );

    const changeToken = await service.requestEmailChange(user.id, 'new-home@example.com');
    expect(notifier.lastTokenFor('new-home@example.com', 'verification')).toBe(changeToken);
    expect((await users.findById(user.id)).emailVerificationToken).toBe(changeToken);

    const confirmed = await service.verifyNewEmail(changeToken);
    expect(confirmed.id).toBe(user.id);
  });

  it('rejects an email change for a user that does not exist', async () => {
    await expect(
      service.requestEmailChange('00000000-0000-4000-8000-000000000000', 'x@example.com')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
