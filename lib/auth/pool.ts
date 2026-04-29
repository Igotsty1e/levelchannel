import { Pool } from 'pg'

import { paymentConfig } from '@/lib/payments/config'

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelAuthPool: Pool | undefined
}

export function getAuthPool() {
  if (!paymentConfig.databaseUrl) {
    throw new Error('DATABASE_URL is not configured for auth storage.')
  }

  if (!global.__levelchannelAuthPool) {
    global.__levelchannelAuthPool = new Pool({
      connectionString: paymentConfig.databaseUrl,
    })
  }

  return global.__levelchannelAuthPool
}
