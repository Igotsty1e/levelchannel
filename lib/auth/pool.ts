import { getDbPool } from '@/lib/db/pool'

// Auth code reaches Postgres through a single shared pool now —
// `lib/db/pool.ts`. The thin re-export here exists for legibility:
// auth call sites still type `getAuthPool().query(...)`, which makes
// the trust boundary clear at the call site.
export function getAuthPool() {
  return getDbPool()
}
