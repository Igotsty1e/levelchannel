import type { PaymentProvider } from '@/lib/payments/types'

function parseProvider(value: string | undefined): PaymentProvider {
  return value === 'cloudpayments' ? 'cloudpayments' : 'mock'
}

function parseStorageBackend(value: string | undefined) {
  return value === 'postgres' ? 'postgres' : 'file'
}

export const paymentConfig = {
  provider: parseProvider(process.env.PAYMENTS_PROVIDER),
  storageBackend: parseStorageBackend(process.env.PAYMENTS_STORAGE_BACKEND),
  storageFile: process.env.PAYMENTS_STORAGE_FILE || 'payment-orders.json',
  databaseUrl: process.env.DATABASE_URL || '',
  mockAutoConfirmSeconds: Number(process.env.PAYMENTS_MOCK_AUTO_CONFIRM_SECONDS || '20'),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  allowMockConfirm:
    process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true' ||
    process.env.NODE_ENV !== 'production',
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
