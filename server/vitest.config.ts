import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    // Tests share one database, so run files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://dev:dev@localhost:5432/clinicq_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      DEMO_MODE: 'false',
    },
  },
});
