/**
 * E2E Tests: User Management REST API Endpoints
 *
 * Testing complete user API workflows with actual HTTP requests
 */

import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../src/app';
import { generateToken } from '../../src/libs/auth/jwt.utils';

describe('User REST API E2E Tests', () => {
  let app: Express;
  let authToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createApp();

    // Generate auth tokens for testing
    authToken = generateToken({
      userId: 'user-123',
      email: 'test@test.com',
      role: 'customer',
    });

    adminToken = generateToken({
      userId: 'admin-123',
      email: 'admin@test.com',
      role: 'admin',
    });
  });

  describe('POST /api/users/register', () => {
    it('should register new user successfully', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'newuser@test.com',
          password: 'SecurePass123!',
          firstName: 'New',
          lastName: 'User',
        })
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('newuser@test.com');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'weak@test.com',
          password: 'weak',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);

      expect(response.body.error).toContain('password');
    });

    it('should return 409 for duplicate email', async () => {
      await request(app).post('/api/users/register').send({
        email: 'duplicate@test.com',
        password: 'SecurePass123!',
        firstName: 'First',
        lastName: 'User',
      });

      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'duplicate@test.com',
          password: 'SecurePass123!',
          firstName: 'Second',
          lastName: 'User',
        })
        .expect(409);

      expect(response.body.error).toContain('already exists');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'incomplete@test.com',
          // Missing password, firstName, lastName
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/users/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          email: 'existing@test.com',
          password: 'CorrectPass123!',
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('existing@test.com');
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          email: 'existing@test.com',
          password: 'WrongPassword',
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should return 401 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'AnyPassword123!',
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should update last login timestamp', async () => {
      const loginResponse = await request(app)
        .post('/api/users/login')
        .send({
          email: 'tracking@test.com',
          password: 'TrackPass123!',
        })
        .expect(200);

      const token = loginResponse.body.token;

      const profileResponse = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(profileResponse.body.lastLoginAt).toBeDefined();
    });
  });

  describe('GET /api/users/profile', () => {
    it('should get user profile with valid token', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should return 401 without auth token', async () => {
      await request(app).get('/api/users/profile').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('should update user profile', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Updated',
          lastName: 'Name',
          phoneNumber: '+15555555555',
        })
        .expect(200);

      expect(response.body.firstName).toBe('Updated');
      expect(response.body.lastName).toBe('Name');
    });

    it('should not allow email update through profile endpoint', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'newemail@test.com',
        })
        .expect(400);

      expect(response.body.error).toContain('email');
    });

    it('should validate phone number format', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          phoneNumber: 'invalid-phone',
        })
        .expect(400);

      expect(response.body.error).toContain('phone');
    });
  });

  describe('POST /api/users/verify-email', () => {
    it('should verify email with valid token', async () => {
      const response = await request(app)
        .post('/api/users/verify-email')
        .send({
          token: 'valid-verification-token',
        })
        .expect(200);

      expect(response.body.emailVerifiedAt).toBeDefined();
      expect(response.body.status).toBe('active');
    });

    it('should return 400 for invalid token', async () => {
      const response = await request(app)
        .post('/api/users/verify-email')
        .send({
          token: 'invalid-token',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid');
    });
  });

  describe('POST /api/users/forgot-password', () => {
    it('should initiate password reset', async () => {
      const response = await request(app)
        .post('/api/users/forgot-password')
        .send({
          email: 'forgotpass@test.com',
        })
        .expect(200);

      expect(response.body.message).toContain('reset');
    });

    it('should not reveal if email exists', async () => {
      const response = await request(app)
        .post('/api/users/forgot-password')
        .send({
          email: 'nonexistent@test.com',
        })
        .expect(200);

      expect(response.body.message).toContain('reset');
    });
  });

  describe('POST /api/users/reset-password', () => {
    it('should reset password with valid token', async () => {
      const response = await request(app)
        .post('/api/users/reset-password')
        .send({
          token: 'valid-reset-token',
          newPassword: 'NewSecurePass123!',
        })
        .expect(200);

      expect(response.body.message).toContain('success');
    });

    it('should validate new password strength', async () => {
      const response = await request(app)
        .post('/api/users/reset-password')
        .send({
          token: 'valid-reset-token',
          newPassword: 'weak',
        })
        .expect(400);

      expect(response.body.error).toContain('password');
    });
  });

  describe('POST /api/users/change-password', () => {
    it('should change password for authenticated user', async () => {
      const response = await request(app)
        .post('/api/users/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass456!',
        })
        .expect(200);

      expect(response.body.message).toContain('success');
    });

    it('should return 401 for incorrect current password', async () => {
      const response = await request(app)
        .post('/api/users/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'WrongPass123!',
          newPassword: 'NewPass456!',
        })
        .expect(401);

      expect(response.body.error).toContain('current password');
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/users/change-password')
        .send({
          currentPassword: 'OldPass123!',
          newPassword: 'NewPass456!',
        })
        .expect(401);
    });
  });

  describe('GET /api/users (Admin Only)', () => {
    it('should list all users for admin', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body).toHaveProperty('total');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/users?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
      expect(response.body.users.length).toBeLessThanOrEqual(10);
    });

    it('should return 403 for non-admin users', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(response.body.error).toContain('admin');
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/users?status=active')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.users.every((u: any) => u.status === 'active')).toBe(
        true
      );
    });

    it('should filter by role', async () => {
      const response = await request(app)
        .get('/api/users?role=customer')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.users.every((u: any) => u.role === 'customer')).toBe(
        true
      );
    });
  });

  describe('GET /api/users/:id (Admin Only)', () => {
    it('should get specific user by ID', async () => {
      const response = await request(app)
        .get('/api/users/user-123')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.id).toBe('user-123');
    });

    it('should return 404 for non-existent user', async () => {
      await request(app)
        .get('/api/users/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('should return 403 for non-admin users', async () => {
      await request(app)
        .get('/api/users/other-user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('PUT /api/users/:id (Admin Only)', () => {
    it('should update user role', async () => {
      const response = await request(app)
        .put('/api/users/user-456')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'moderator',
        })
        .expect(200);

      expect(response.body.role).toBe('moderator');
    });

    it('should suspend user account', async () => {
      const response = await request(app)
        .put('/api/users/user-789')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'suspended',
        })
        .expect(200);

      expect(response.body.status).toBe('suspended');
    });

    it('should return 403 for non-admin users', async () => {
      await request(app)
        .put('/api/users/other-user')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'admin',
        })
        .expect(403);
    });
  });

  describe('DELETE /api/users/:id (Admin Only)', () => {
    it('should soft delete user account', async () => {
      const response = await request(app)
        .delete('/api/users/user-delete-1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.message).toContain('deleted');
    });

    it('should return 403 for non-admin users', async () => {
      await request(app)
        .delete('/api/users/some-user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit excessive login attempts', async () => {
      const requests = [];

      // Send 20 login requests rapidly
      for (let i = 0; i < 20; i++) {
        requests.push(
          request(app).post('/api/users/login').send({
            email: 'ratelimit@test.com',
            password: 'AnyPass123!',
          })
        );
      }

      const responses = await Promise.all(requests);

      // Some requests should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .options('/api/users/register')
        .set('Origin', 'https://example.com')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Content-Type Validation', () => {
    it('should reject non-JSON content', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Content-Type', 'text/plain')
        .send('not json')
        .expect(400);

      expect(response.body.error).toContain('JSON');
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize XSS attempts', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .send({
          email: 'xss@test.com',
          password: 'SecurePass123!',
          firstName: '<script>alert("xss")</script>',
          lastName: 'User',
        })
        .expect(201);

      expect(response.body.user.firstName).not.toContain('<script>');
    });

    it('should reject SQL injection attempts', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          email: "admin@test.com' OR '1'='1",
          password: 'AnyPass123!',
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });
  });
});
