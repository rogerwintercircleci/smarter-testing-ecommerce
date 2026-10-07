import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestDatabase, dropTestDatabase, truncateAll } from '../support/database';
import { RecordingNotifier } from '../support/fakes';
import {
  User,
  UserRole,
  UserStatus,
} from '../../../src/services/user-management/entities/user.entity';
import { UserRepository } from '../../../src/services/user-management/repositories/user.repository';
import { UserService } from '../../../src/services/user-management/services/user.service';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../../src/libs/errors';

const STRONG_PASSWORD = 'Str0ng!Passw0rd';

describe('User registration (UserService + UserRepository, real Postgres)', () => {
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

  const registration = (email: string, password = STRONG_PASSWORD) => ({
    email,
    password,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phoneNumber: '+13035550100',
  });

  it('persists a pending customer with a bcrypt-hashed password and normalized email', async () => {
    const { user } = await service.register(registration('Ada.Lovelace@Example.COM'));

    const stored = await users.findById(user.id);
    expect(stored.email).toBe('ada.lovelace@example.com');
    expect(stored.role).toBe(UserRole.CUSTOMER);
    expect(stored.status).toBe(UserStatus.PENDING);
    expect(stored.emailVerifiedAt).toBeNull();
    expect(stored.phoneNumber).toBe('+13035550100');
    expect(stored.password).not.toBe(STRONG_PASSWORD);
    expect(stored.password).toMatch(/^\$2[aby]\$10\$/);
    await expect(bcrypt.compare(STRONG_PASSWORD, stored.password)).resolves.toBe(true);
    expect(stored.emailVerificationToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends welcome and verification emails carrying the stored token', async () => {
    const { user } = await service.register(registration('grace@example.com'));
    const stored = await users.findById(user.id);

    expect(notifier.sent.map((m) => m.type)).toEqual(['welcome', 'verification']);
    expect(notifier.lastTokenFor('grace@example.com', 'verification')).toBe(
      stored.emailVerificationToken
    );
  });

  it('registers without a notification service', async () => {
    const quiet = new UserService(users);
    const { user } = await quiet.register(registration('quiet@example.com'));
    expect(await users.exists({ id: user.id })).toBe(true);
  });

  it('rejects a duplicate email regardless of case and keeps a single row', async () => {
    await service.register(registration('linus@example.com'));

    await expect(service.register(registration('LINUS@example.com'))).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(await users.count()).toBe(1);
  });

  it.each([
    ['too short', 'Sh0rt!'],
    ['no uppercase', 'lowercase1!'],
    ['no lowercase', 'UPPERCASE1!'],
    ['no digit', 'NoDigits!!'],
    ['no special character', 'NoSpecial123'],
  ])('rejects a weak password (%s) without writing a row', async (_case, password) => {
    await expect(service.register(registration('weak@example.com', password))).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(await users.count()).toBe(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it('salts every hash: identical passwords produce distinct hashes', async () => {
    const emails = Array.from({ length: 8 }, (_, i) => `same-password-${i}@example.com`);
    for (const email of emails) {
      await service.register(registration(email));
    }

    const stored = await users.findAll();
    expect(stored).toHaveLength(emails.length);
    expect(new Set(stored.map((u) => u.password)).size).toBe(emails.length);
    for (const user of stored) {
      await expect(bcrypt.compare(STRONG_PASSWORD, user.password)).resolves.toBe(true);
    }
  });

  it('updates only whitelisted profile fields', async () => {
    const { user } = await service.register(registration('profile@example.com'));

    await service.updateProfile(user.id, {
      firstName: 'Augusta',
      phoneNumber: '+13035550199',
      // Fields outside the DTO must be ignored even if a caller sneaks them in.
      ...({ role: UserRole.ADMIN, email: 'hijack@example.com' } as object),
    });

    const stored = await users.findById(user.id);
    expect(stored.firstName).toBe('Augusta');
    expect(stored.lastName).toBe('Lovelace');
    expect(stored.phoneNumber).toBe('+13035550199');
    expect(stored.role).toBe(UserRole.CUSTOMER);
    expect(stored.email).toBe('profile@example.com');
  });

  it('changes the password only when the current password is correct and the new one is strong', async () => {
    const { user } = await service.register(registration('change@example.com'));
    const newPassword = 'An0ther!Secret';

    await expect(
      service.changePassword(user.id, 'Wr0ng!Password', newPassword)
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.changePassword(user.id, STRONG_PASSWORD, 'weak')).rejects.toBeInstanceOf(
      BadRequestError
    );

    await service.changePassword(user.id, STRONG_PASSWORD, newPassword);

    const stored = await users.findById(user.id);
    await expect(bcrypt.compare(newPassword, stored.password)).resolves.toBe(true);
    await expect(bcrypt.compare(STRONG_PASSWORD, stored.password)).resolves.toBe(false);
  });

  it('raises NotFoundError for an unknown user id', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(service.getUserById(missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getUserById(missing)).rejects.toThrow(`User with ID ${missing} not found`);
  });

  it('finds registered users by role and status', async () => {
    const created: User[] = [];
    for (let i = 0; i < 6; i++) {
      created.push((await service.register(registration(`member-${i}@example.com`))).user);
    }
    await users.update(created[0].id, { role: UserRole.ADMIN });
    await users.update(created[1].id, { role: UserRole.VENDOR, status: UserStatus.ACTIVE });
    await users.update(created[2].id, { status: UserStatus.SUSPENDED });

    expect((await users.findByRole(UserRole.ADMIN)).map((u) => u.id)).toEqual([created[0].id]);
    expect((await users.findByRole(UserRole.VENDOR)).map((u) => u.id)).toEqual([created[1].id]);
    expect(await users.findByRole(UserRole.CUSTOMER)).toHaveLength(4);
    expect(await users.findByStatus(UserStatus.PENDING)).toHaveLength(4);
    expect((await users.findByStatus(UserStatus.SUSPENDED)).map((u) => u.id)).toEqual([
      created[2].id,
    ]);
  });
});
