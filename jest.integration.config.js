/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.integration.test.ts'],
  testTimeout: 30000,
  moduleNameMapper: {
    '^@codex-mobile-bridge/(.*)$': '<rootDir>/packages/$1/src',
  },
};
