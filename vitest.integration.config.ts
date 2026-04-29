import { defineConfig } from 'vitest/config'

// Integration test runner — invoked via scripts/test-integration.sh
// (which provides DATABASE_URL pointing at Docker Postgres). Distinct
// config from vitest.config.ts so unit `npm run test:run` stays fast
// and dependency-free.
//
// Tests live under tests/integration/ and exercise lib/auth/* store ops
// + (later) /api/auth/* route handlers against a real Postgres 16.13.

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    pool: 'forks',
    testTimeout: 15000,
  },
})
