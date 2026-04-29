import type { PaymentProvider } from '@/lib/payments/types'

function parseProvider(value: string | undefined): PaymentProvider {
  return value === 'cloudpayments' ? 'cloudpayments' : 'mock'
}

function parseStorageBackend(value: string | undefined) {
  return value === 'postgres' ? 'postgres' : 'file'
}

function parseSiteUrl(value: string | undefined) {
  const fallback = 'http://localhost:3000'
  const candidate = value && value.trim() ? value.trim() : fallback

  try {
    const parsed = new URL(candidate)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('protocol must be http(s)')
    }

    return parsed.origin
  } catch {
    return fallback
  }
}

const provider = parseProvider(process.env.PAYMENTS_PROVIDER)
const siteUrl = parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)
// NEXT_PHASE=phase-production-build выставляется только во время `next build`.
// На этой стадии Next прогоняет module-level код всех роутов, чтобы собрать
// статические страницы — но реальные env пока могут отсутствовать. Не валим
// сборку: сами проверки сработают на старте сервера в проде (`next start`).
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const isProd = process.env.NODE_ENV === 'production' && !isBuildPhase

// Жёсткие фейлы на старте: в проде сайт без правильного siteUrl сломает
// successRedirectUrl/failRedirectUrl и уведёт пользователя на localhost
// после успешного списания. Лучше уронить приложение, чем потерять платёж.
if (isProd && provider === 'cloudpayments' && siteUrl.startsWith('http://localhost')) {
  throw new Error(
    'NEXT_PUBLIC_SITE_URL must be a real https URL when PAYMENTS_PROVIDER=cloudpayments in production.',
  )
}

if (
  isProd &&
  provider === 'cloudpayments' &&
  (!process.env.CLOUDPAYMENTS_PUBLIC_ID || !process.env.CLOUDPAYMENTS_API_SECRET)
) {
  throw new Error(
    'CLOUDPAYMENTS_PUBLIC_ID and CLOUDPAYMENTS_API_SECRET are required when PAYMENTS_PROVIDER=cloudpayments in production.',
  )
}

if (isProd && process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true') {
  throw new Error(
    'PAYMENTS_ALLOW_MOCK_CONFIRM=true is not allowed in production. Disable it before deploying.',
  )
}

export const paymentConfig = {
  provider,
  storageBackend: parseStorageBackend(process.env.PAYMENTS_STORAGE_BACKEND),
  storageFile: process.env.PAYMENTS_STORAGE_FILE || 'payment-orders.json',
  databaseUrl: process.env.DATABASE_URL || '',
  mockAutoConfirmSeconds: Number(process.env.PAYMENTS_MOCK_AUTO_CONFIRM_SECONDS || '20'),
  siteUrl,
  // Безопасный дефолт: mock-confirm закрыт, пока его явно не открыли через
  // PAYMENTS_ALLOW_MOCK_CONFIRM=true. В проде сам флаг тоже ловится выше.
  allowMockConfirm: process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true',
  cloudpayments: {
    publicId: process.env.CLOUDPAYMENTS_PUBLIC_ID || '',
    apiSecret: process.env.CLOUDPAYMENTS_API_SECRET || '',
  },
}

export function isCloudPaymentsConfigured() {
  return Boolean(
    paymentConfig.cloudpayments.publicId && paymentConfig.cloudpayments.apiSecret,
  )
}
