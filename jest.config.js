/**
 * Unit and workflow tests: fast, fully mocked, no external services.
 */
const shared = require('./jest.shared');

module.exports = {
  ...shared,
  roots: ['<rootDir>/src', '<rootDir>/tests/workflows'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  testTimeout: 30000,
};
