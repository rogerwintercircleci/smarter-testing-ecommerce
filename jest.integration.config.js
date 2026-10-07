/**
 * Integration tests: run against a real PostgreSQL database.
 * Start one locally with `npm run db:up`.
 */
const shared = require('./jest.shared');

module.exports = {
  ...shared,
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.int.test.ts'],
  testTimeout: 60000,
};
