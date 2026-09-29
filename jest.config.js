/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // All test files share one test database, so they must run one at a time.
  maxWorkers: 1,
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
