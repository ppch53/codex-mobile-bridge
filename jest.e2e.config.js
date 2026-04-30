/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.e2e.test.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@codex-mobile-bridge/(.*)$': '<rootDir>/packages/$1/src',
  },
};
