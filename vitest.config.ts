import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
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
        'lib/auth/email-hash.ts',
        'lib/email/escape.ts',
      ],
      // COVERAGE-PAYMENTS (2026-05-18) — ratchet up from 70/70/70/70
      // after adding refundTransaction + chargeWithSavedToken
      // invalid-JSON unit tests. Floor each threshold a few points
      // below the actual measured value so a stray regression trips
      // CI but normal churn doesn't. Payments alone sits at ~96/89/97/96.
      thresholds: {
        lines: 85,
        functions: 95,
        branches: 80,
        statements: 85,
      },
    },
  },
})
