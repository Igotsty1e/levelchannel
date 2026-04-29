// Test env defaults. `TEST_INTEGRATION=1` is set by
// `scripts/test-integration.sh` and switches several knobs to "talk to
// the live Docker Postgres in mock-payment mode" so route handlers can
// be exercised end-to-end without actually calling CloudPayments.
//
// Unit-test mode keeps the historical defaults (provider=cloudpayments,
// storage=file) — those tests imitate the CP wire format and don't
// need a real DB.

const integration = process.env.TEST_INTEGRATION === '1'

// CloudPayments creds для тестов проверки подписи и API вызовов.
// Реальные ключи никогда не должны попадать в .env, читаемый vitest.
process.env.CLOUDPAYMENTS_PUBLIC_ID = process.env.CLOUDPAYMENTS_PUBLIC_ID || 'test_public_id'
process.env.CLOUDPAYMENTS_API_SECRET = process.env.CLOUDPAYMENTS_API_SECRET || 'test_api_secret'
process.env.PAYMENTS_PROVIDER =
  process.env.PAYMENTS_PROVIDER || (integration ? 'mock' : 'cloudpayments')
process.env.PAYMENTS_STORAGE_BACKEND =
  process.env.PAYMENTS_STORAGE_BACKEND || (integration ? 'postgres' : 'file')
process.env.PAYMENTS_ALLOW_MOCK_CONFIRM =
  process.env.PAYMENTS_ALLOW_MOCK_CONFIRM || (integration ? 'true' : '')
process.env.NEXT_PUBLIC_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
process.env.TELEMETRY_HASH_SECRET = process.env.TELEMETRY_HASH_SECRET || 'test-secret'
