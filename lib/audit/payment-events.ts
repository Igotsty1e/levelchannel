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

  try {
    await pool.query(
      `insert into payment_audit_events (
        event_type, invoice_id, account_id,
        customer_email, client_ip, user_agent,
        amount_kopecks, from_status, to_status,
        actor, idempotency_key, request_id, payload
      ) values (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13
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
  const { rows } = await pool.query(
    `select id, created_at, event_type, invoice_id, account_id,
            customer_email, client_ip, user_agent,
            amount_kopecks, from_status, to_status,
            actor, idempotency_key, request_id, payload
       from payment_audit_events
      where invoice_id = $1
      order by created_at asc`,
    [invoiceId],
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
