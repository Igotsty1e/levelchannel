import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Только то, что покрываем сейчас юнитами. Postgres и file backends
      // тестируются интеграционно (живая БД / FS); их покрытие отдельной
      // ratchet'ой можно добавить позже.
      include: [
        'lib/payments/catalog.ts',
        'lib/payments/cloudpayments-api.ts',
        'lib/payments/cloudpayments-webhook.ts',
        'lib/payments/tokens.ts',
        'lib/security/rate-limit.ts',
        'lib/security/idempotency.ts',
        'lib/security/request.ts',
        'lib/auth/password.ts',
        'lib/auth/tokens.ts',
        'lib/auth/policy.ts',
        'lib/email/escape.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
})
