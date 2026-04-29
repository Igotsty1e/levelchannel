import { getDbPoolOrNull } from '@/lib/db/pool'

// Audit code uses the shared pool via `lib/db/pool.ts`. The
// "OrNull" variant is the right shape for audit specifically —
// `recordPaymentAuditEvent` is best-effort and silently no-ops
// when DATABASE_URL is missing (local dev without Postgres),
// so we don't want a throw.
export function getAuditPool() {
  return getDbPoolOrNull()
}
