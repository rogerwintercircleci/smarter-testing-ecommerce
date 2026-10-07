/**
 * Settings shared by the unit and integration Jest configs.
 */
module.exports = {
  preset: 'ts-jest',
  // Records which source files each test file executes, for
  // CircleCI test impact analysis. Behaves like the 'node' environment.
  testEnvironment: '@circleci/jest-circleci-coverage/environment-node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@libs/(.*)$': '<rootDir>/src/libs/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  reporters: [
    'default',
    // Smarter Testing reads JUnit results; the file attribute maps each result to its test file.
    ['jest-junit', { addFileAttribute: 'true', suiteNameTemplate: '{filepath}' }],
    '@circleci/jest-circleci-coverage/reporter',
  ],
  cacheDirectory: '.jest-cache',
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
