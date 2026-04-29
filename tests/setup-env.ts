// CloudPayments creds для тестов проверки подписи и API вызовов.
// Реальные ключи никогда не должны попадать в .env, читаемый vitest.
process.env.CLOUDPAYMENTS_PUBLIC_ID = process.env.CLOUDPAYMENTS_PUBLIC_ID || 'test_public_id'
process.env.CLOUDPAYMENTS_API_SECRET = process.env.CLOUDPAYMENTS_API_SECRET || 'test_api_secret'
process.env.PAYMENTS_PROVIDER = process.env.PAYMENTS_PROVIDER || 'cloudpayments'
process.env.PAYMENTS_STORAGE_BACKEND = process.env.PAYMENTS_STORAGE_BACKEND || 'file'
process.env.NEXT_PUBLIC_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
process.env.TELEMETRY_HASH_SECRET = process.env.TELEMETRY_HASH_SECRET || 'test-secret'
