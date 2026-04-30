
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$', '\\.e2e\\.test\\.ts$'],
  collectCoverageFrom: ['packages/**/src/**/*.ts', 'apps/bridge/src/**/*.ts', '!**/*.test.ts', '!**/*.d.ts'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 55,
      functions: 75,
      lines: 70,
    },
    './packages/security/src/': {
      statements: 85,
      branches: 75,
      functions: 85,
      lines: 85,
    },
  },
  moduleNameMapper: {
    '^@codex-mobile-bridge/(.*)$': '<rootDir>/packages/$1/src',
  },
};
