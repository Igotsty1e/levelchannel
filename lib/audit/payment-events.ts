import { getAuditEncryptionKey } from '@/lib/audit/encryption'
import { getAuditPool } from '@/lib/audit/pool'

// Audit-log-of-record for payment lifecycle transitions. See
// migrations/0012_payment_audit_events.sql for schema rationale.
//
// Failure mode: best-effort. If the audit insert throws, we log a
// warning and swallow — an outage of the audit table must NEVER
// block a real payment. The uptime monitor catches Postgres outages
// independently.
//
// Identity: full e-mail and full IP are recorded (NOT hashed/masked).
// This is intentional. Audit logs are admin-only and serve the
// legitimate-interest basis under 152-FZ — see SECURITY.md.
//
// Wave 2.1 (security) — encryption-at-rest:
//   When AUDIT_ENCRYPTION_KEY is set, every insert dual-writes the
//   sensitive columns (customer_email, client_ip) into both the
//   plaintext column AND a pgcrypto-encrypted bytea column
//   (customer_email_enc, client_ip_enc). Reads prefer the encrypted
//   column with a plaintext fallback so the operator's eventual
//   "null out plaintext" step (Phase B in migration 0025) is invisible
//   to consumers. See migrations/0025_payment_audit_events_pgcrypto.sql
//   for the three-phase migration plan.

export const PAYMENT_AUDIT_EVENT_TYPES = [
  'order.created',
  'order.cancelled',
  'mock.confirmed',
  'webhook.check.received',
  'webhook.check.declined',
  'webhook.pay.received',
  'webhook.pay.processed',
  'webhook.pay.validation_failed',
  'webhook.fail.received',
  'webhook.fail.declined',
  'webhook.fail.processed',
  'charge_token.succeeded',
  'charge_token.requires_3ds',
  'charge_token.declined',
  'threeds.callback.received',
  'threeds.confirmed',
  'threeds.declined',
] as const

export type PaymentAuditEventType = (typeof PAYMENT_AUDIT_EVENT_TYPES)[number]

export type PaymentAuditActor =
  | 'user'
  | `webhook:cloudpayments:${'check' | 'pay' | 'fail'}`
  | 'admin'
  | 'cron'
  | 'system'

// Convert payment_orders.amount_rub (numeric, e.g. 2500.00) to the
// integer kopecks the audit table stores. Rounding instead of floor()
// because the order amount comes from the API as a Number — IEEE 754
// drift on values like 2500.0000000001 should not turn into 249999.
export function rublesToKopecks(amountRub: number): number {
  return Math.round(amountRub * 100)
}

export type RecordPaymentAuditEvent = {
  eventType: PaymentAuditEventType
  invoiceId: string
  accountId?: string | null
  // Nullable as of migration 0014. Pre-validation phase webhook events
  // may not have a trustworthy email at the moment of recording (the
  // Order lookup may fail, the payload's `Email` field is not yet
  // cross-checked). Caller passes null in that case rather than a
  // placeholder that could later be confused with real data.
  customerEmail: string | null
  clientIp?: string | null
  userAgent?: string | null
  amountKopecks: number
  fromStatus?: string | null
  toStatus?: string | null
  actor: PaymentAuditActor
  idempotencyKey?: string | null
  requestId?: string | null
  payload?: Record<string, unknown>
}

// Best-effort recorder. Returns true on success, false on swallowed
// failure. Callers do NOT need to check the return value — it's
// surfaced for tests and admin tooling only.
export async function recordPaymentAuditEvent(
  event: RecordPaymentAuditEvent,
): Promise<boolean> {
  const pool = getAuditPool()
  if (!pool) {
    // No DATABASE_URL — local dev without postgres. Silent skip
    // (file-backend mode for payments doesn't expect audit either).
    return false
  }

  // Resolve the encryption key. In production a missing key throws,
  // which lands in the catch below; the audit insert is then
  // swallowed (best-effort), surfaces a warn in journalctl, and the
  // business path continues. The operator gets a loud signal at the
  // very next audit attempt and fixes the env. We deliberately do
  // not start dual-writing without the key — partial state is worse
  // than transient logging.
  let encryptionKey: string | null = null
  try {
    encryptionKey = getAuditEncryptionKey()
  } catch (err) {
    console.warn('[audit] encryption key unavailable:', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  try {
    // The CASE WHEN ... pgp_sym_encrypt(...) END pattern returns
    // bytea when both key and plaintext are non-null, and NULL
    // otherwise. We pass the key as $14 so it never reaches the
    // application logs (parameter values are visible in pg_stat
    // tables, but not in plain query strings).
    await pool.query(
      `insert into payment_audit_events (
        event_type, invoice_id, account_id,
        customer_email, client_ip, user_agent,
        amount_kopecks, from_status, to_status,
        actor, idempotency_key, request_id, payload,
        customer_email_enc, client_ip_enc
      ) values (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        case when $14::text is not null and $4::text is not null
             then pgp_sym_encrypt($4::text, $14::text) end,
        case when $14::text is not null and $5::text is not null
             then pgp_sym_encrypt($5::text, $14::text) end
      )`,
      [
        event.eventType,
        event.invoiceId,
        event.accountId ?? null,
        event.customerEmail ?? null,
        event.clientIp ?? null,
        event.userAgent ?? null,
        event.amountKopecks,
        event.fromStatus ?? null,
        event.toStatus ?? null,
        event.actor,
        event.idempotencyKey ?? null,
        event.requestId ?? null,
        JSON.stringify(event.payload ?? {}),
        encryptionKey,
      ],
    )
    return true
  } catch (err) {
    // Best-effort: log and move on. Use console.warn so it lands in
    // journalctl but doesn't fail the request. We deliberately do NOT
    // re-throw — the calling business path must continue.
    console.warn('[audit] payment-event insert failed:', {
      eventType: event.eventType,
      invoiceId: event.invoiceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ---- read side (admin tooling, tests) ----

export type StoredPaymentAuditEvent = {
  id: string
  createdAt: string
  eventType: PaymentAuditEventType
  invoiceId: string
  accountId: string | null
  customerEmail: string | null
  clientIp: string | null
  userAgent: string | null
  amountKopecks: number
  fromStatus: string | null
  toStatus: string | null
  actor: string
  idempotencyKey: string | null
  requestId: string | null
  payload: Record<string, unknown>
}

export async function listPaymentAuditEventsByInvoice(
  invoiceId: string,
): Promise<StoredPaymentAuditEvent[]> {
  const pool = getAuditPool()
  if (!pool) return []

  // Prefer the encrypted column when present, fall back to plaintext.
  // This makes the eventual Phase-B "null out plaintext" step
  // invisible to callers — they keep getting the same shape, sourced
  // from whichever column has data. In dev (no key set), the
  // encrypted column is always null and we transparently read
  // plaintext as before.
  let key: string | null = null
  try {
    key = getAuditEncryptionKey()
  } catch {
    // Production-mandatory key missing. Surface a clear warning but
    // still return what we can read via plaintext, so admin tooling
    // doesn't go dark just because the env is misconfigured.
    console.warn(
      '[audit] AUDIT_ENCRYPTION_KEY missing in production — reading plaintext only.',
    )
    key = null
  }

  const { rows } = await pool.query(
    `select id, created_at, event_type, invoice_id, account_id,
            case when customer_email_enc is not null and $2::text is not null
                 then pgp_sym_decrypt(customer_email_enc, $2::text)
                 else customer_email
            end as customer_email,
            case when client_ip_enc is not null and $2::text is not null
                 then pgp_sym_decrypt(client_ip_enc, $2::text)
                 else client_ip
            end as client_ip,
            user_agent,
            amount_kopecks, from_status, to_status,
            actor, idempotency_key, request_id, payload
       from payment_audit_events
      where invoice_id = $1
      order by created_at asc`,
    [invoiceId, key],
  )
  return rows.map(rowToEvent)
}

function rowToEvent(row: Record<string, unknown>): StoredPaymentAuditEvent {
  return {
    id: String(row.id),
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    eventType: row.event_type as PaymentAuditEventType,
    invoiceId: String(row.invoice_id),
    accountId: row.account_id == null ? null : String(row.account_id),
    customerEmail: row.customer_email == null ? null : String(row.customer_email),
    clientIp: row.client_ip == null ? null : String(row.client_ip),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
    amountKopecks: Number(row.amount_kopecks),
    fromStatus: row.from_status == null ? null : String(row.from_status),
    toStatus: row.to_status == null ? null : String(row.to_status),
    actor: String(row.actor),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    requestId: row.request_id == null ? null : String(row.request_id),
    payload:
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : {},
  }
}
