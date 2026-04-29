import { Pool } from 'pg'

// Audit log uses its own pg Pool so an outage of the payments-domain
// pool can't take down audit recording, and vice versa. Connection
// count cost is small (default 10 max). If the project ever hits a
// connection-count ceiling, consolidating all per-domain pools into
// one shared `lib/db/pool.ts` is the right fix — tracked as a backlog
// item ("consolidate Postgres pools").

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelAuditPool: Pool | undefined
}

export function getAuditPool(): Pool | null {
  const url = process.env.DATABASE_URL
  if (!url) return null

  if (!global.__levelchannelAuditPool) {
    global.__levelchannelAuditPool = new Pool({
      connectionString: url,
      // Cap audit's connection appetite — real load lives on the
      // payment / auth pools.
      max: 4,
    })
  }
  return global.__levelchannelAuditPool
}
