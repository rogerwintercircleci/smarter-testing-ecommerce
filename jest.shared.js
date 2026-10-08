/**
 * Settings shared by the unit and integration Jest configs.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@libs/(.*)$': '<rootDir>/src/libs/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  reporters: [
    'default',
    // JUnit results for the CircleCI Tests tab. The file attribute records which test file each result came from.
    ['jest-junit', { addFileAttribute: 'true', suiteNameTemplate: '{filepath}' }],
  ],
  cacheDirectory: '.jest-cache',
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
