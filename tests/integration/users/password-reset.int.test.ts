import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { RecordingNotifier } from '../support/fakes';
import { User } from '../../../src/services/user-management/entities/user.entity';
import { UserRepository } from '../../../src/services/user-management/repositories/user.repository';
import { UserService } from '../../../src/services/user-management/services/user.service';
import { BadRequestError, NotFoundError } from '../../../src/libs/errors';

const OLD_PASSWORD = '0ld!Password';
const NEW_PASSWORD = 'N3w!Password';
const ONE_HOUR = 60 * 60 * 1000;

describe('Password reset (UserService + UserRepository, real Postgres)', () => {
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

  async function verifiedUser(email: string): Promise<User> {
    await service.register({ email, password: OLD_PASSWORD, firstName: 'Pat', lastName: 'Doe' });
    return service.verifyEmail(notifier.lastTokenFor(email, 'verification')!);
  }

  it('stores a reset token that expires in one hour and emails it', async () => {
    const user = await verifiedUser('reset@example.com');
    const before = Date.now();

    const result = await service.requestPasswordReset('Reset@Example.com');

    expect(result!.id).toBe(user.id);
    const stored = await users.findById(user.id);
    const emailed = notifier.lastTokenFor('reset@example.com', 'password-reset');
    expect(stored.passwordResetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(emailed).toBe(stored.passwordResetToken);
    expect(stored.passwordResetExpires!.getTime()).toBeGreaterThanOrEqual(before + ONE_HOUR - 1000);
    expect(stored.passwordResetExpires!.getTime()).toBeLessThanOrEqual(Date.now() + ONE_HOUR + 1000);
  });

  it('does not reveal whether an email is registered', async () => {
    await verifiedUser('known@example.com');
    await expect(service.requestPasswordReset('unknown@example.com')).resolves.toBeNull();
    expect(notifier.sent.filter((m) => m.type === 'password-reset')).toHaveLength(0);
  });

  it('replaces the password so only the new one logs in', async () => {
    const user = await verifiedUser('swap@example.com');
    await service.requestPasswordReset('swap@example.com');
    const token = notifier.lastTokenFor('swap@example.com', 'password-reset')!;

    await service.resetPassword(token, NEW_PASSWORD);

    const stored = await users.findById(user.id);
    await expect(bcrypt.compare(NEW_PASSWORD, stored.password)).resolves.toBe(true);
    await expect(service.login('swap@example.com', NEW_PASSWORD)).resolves.toHaveProperty('accessToken');
    await expect(service.login('swap@example.com', OLD_PASSWORD)).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown reset token', async () => {
    await verifiedUser('nobody-asked@example.com');
    await expect(service.resetPassword('a'.repeat(64), NEW_PASSWORD)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an expired token and leaves the password untouched', async () => {
    const user = await verifiedUser('late@example.com');
    await service.requestPasswordReset('late@example.com');
    const token = notifier.lastTokenFor('late@example.com', 'password-reset')!;
    await users.update(user.id, { passwordResetExpires: new Date('2020-06-01T00:00:00Z') });

    await expect(service.resetPassword(token, NEW_PASSWORD)).rejects.toThrow(
      new BadRequestError('Password reset token has expired')
    );

    const stored = await users.findById(user.id);
    await expect(bcrypt.compare(OLD_PASSWORD, stored.password)).resolves.toBe(true);
  });

  it('rejects a weak replacement password and leaves the password untouched', async () => {
    const user = await verifiedUser('weak-reset@example.com');
    await service.requestPasswordReset('weak-reset@example.com');
    const token = notifier.lastTokenFor('weak-reset@example.com', 'password-reset')!;

    await expect(service.resetPassword(token, 'password')).rejects.toBeInstanceOf(BadRequestError);

    const stored = await users.findById(user.id);
    await expect(bcrypt.compare(OLD_PASSWORD, stored.password)).resolves.toBe(true);
  });

  it('invalidates an earlier token when a new reset is requested', async () => {
    await verifiedUser('twice@example.com');
    await service.requestPasswordReset('twice@example.com');
    const first = notifier.lastTokenFor('twice@example.com', 'password-reset')!;
    await service.requestPasswordReset('twice@example.com');
    const second = notifier.lastTokenFor('twice@example.com', 'password-reset')!;

    expect(second).not.toBe(first);
    await expect(service.resetPassword(first, NEW_PASSWORD)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.resetPassword(second, NEW_PASSWORD)).resolves.toHaveProperty('email', 'twice@example.com');
  });

  it('only resets the account that owns the token', async () => {
    const owner = await verifiedUser('owner@example.com');
    const other = await verifiedUser('other@example.com');
    await service.requestPasswordReset('owner@example.com');

    await service.resetPassword(notifier.lastTokenFor('owner@example.com', 'password-reset')!, NEW_PASSWORD);

    await expect(bcrypt.compare(NEW_PASSWORD, (await users.findById(owner.id)).password)).resolves.toBe(true);
    await expect(bcrypt.compare(OLD_PASSWORD, (await users.findById(other.id)).password)).resolves.toBe(true);
    expect((await users.findById(other.id)).passwordResetToken).toBeNull();
  });
});
