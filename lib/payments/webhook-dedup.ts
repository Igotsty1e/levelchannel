import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

// Webhook delivery dedup. Wraps `handleCloudPaymentsWebhook` so a
// retried delivery from CloudPayments (same TransactionId, same kind)
// returns the previously-stored response WITHOUT re-running the
// handler — no second markOrderPaid, no duplicate audit row, no
// duplicate operator email, no duplicate allocation insert.
//
// Why a separate module from `lib/security/idempotency.ts`:
//   - the idempotency module dedups on a CLIENT-supplied
//     `Idempotency-Key` header for our own POST `/api/payments` flow;
//     the key is request-body-bound and meant for client retries.
//   - this module dedups on a PROVIDER-supplied `TransactionId` for
//     incoming webhooks; the dedup is hash-bound to the provider's
//     transaction, not to a request body. Conflating the two
//     muddles two distinct trust boundaries.
//
// Wave 2.3 — request fingerprint check (post-Wave-2 adversarial #7):
//   The dedup PK is (provider, kind, transaction_id). HMAC proves
//   the webhook came from a secret-holder. If the secret leaks, an
//   attacker can craft a webhook with a fabricated TransactionId
//   chosen to collide with a future legit one. The attacker's
//   outcome (typically a validation-failure `code: <nonzero>`)
//   gets cached; the legit retry later short-circuits to that
//   failure. The fingerprint — sha256 of (invoice_id, amount, email)
//   — guards this: on cache hit, mismatched fingerprints fall
//   through to the handler instead of trusting the cache.
//
//   The fingerprint is NOT part of the PK — that would let an
//   attacker submit two webhooks with the same TxId but different
//   content and have BOTH cached, defeating dedup. Keeping the
//   identity scope tight (TxId only) and using the fingerprint as a
//   content check is the right shape.
//
// Race condition (rare but real): two concurrent retries arrive with
// the same TransactionId before the first finishes. Both pass the
// pre-handler lookup (no row yet), both run the handler, the second
// insert hits ON CONFLICT DO NOTHING and keeps the first's row. The
// handler-level operations are individually idempotent (markOrderPaid
// is paid→paid no-op; payment_allocations PK rejects dups; tokens
// upsert by email). Operator email may fire twice in the rare race;
// acceptable for an edge case CloudPayments does not exercise in
// practice (their retry cadence is minutes, not milliseconds).

let initPromise: Promise<void> | null = null

export type WebhookDeliveryOutcome = {
  status: number
  body: unknown
}

export async function ensureWebhookDeliveriesSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getDbPool()
      await pool.query(`
        create table if not exists webhook_deliveries (
          provider text not null,
          kind text not null,
          transaction_id text not null,
          invoice_id text null,
          response_status int not null,
          response_body jsonb not null,
          request_fingerprint text null,
          received_at timestamptz not null default now(),
          primary key (provider, kind, transaction_id),
          constraint webhook_deliveries_provider_check
            check (provider in ('cloudpayments')),
          constraint webhook_deliveries_kind_check
            check (kind in ('check', 'pay', 'fail'))
        )
      `)
      // Wave 2.3: ensure the column exists when ensureSchema runs
      // against a pre-Wave-2.3 schema (the migration runner already
      // covers fresh DBs; this `add column if not exists` is the
      // belt-and-suspenders for any path that calls this function).
      await pool.query(`
        alter table webhook_deliveries
          add column if not exists request_fingerprint text null
      `)
      await pool.query(`
        create index if not exists webhook_deliveries_received_at_idx
          on webhook_deliveries (received_at)
      `)
      await pool.query(`
        create index if not exists webhook_deliveries_invoice_idx
          on webhook_deliveries (invoice_id)
          where invoice_id is not null
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

// Lookup result shape. `fingerprint_mismatch` is its own kind so the
// caller can log + run the handler intentionally, distinct from a
// raw cache miss. (Pragmatic: today both branches do the same thing
// — fall through to the handler — but distinguishing them keeps the
// observability layer honest.)
export type WebhookDeliveryLookup =
  | { kind: 'hit'; outcome: WebhookDeliveryOutcome }
  | { kind: 'miss' }
  | { kind: 'fingerprint_mismatch'; cachedFingerprint: string }

export async function lookupWebhookDelivery(
  provider: string,
  kind: string,
  transactionId: string,
  incomingFingerprint: string | null = null,
): Promise<WebhookDeliveryLookup> {
  const pool = getDbPool()
  const result = await pool.query(
    `select response_status, response_body, request_fingerprint
     from webhook_deliveries
     where provider = $1 and kind = $2 and transaction_id = $3`,
    [provider, kind, transactionId],
  )

  if (result.rows.length === 0) {
    return { kind: 'miss' }
  }

  const row = result.rows[0]
  const cachedFingerprint =
    row.request_fingerprint != null && row.request_fingerprint !== ''
      ? String(row.request_fingerprint)
      : null

  // Either-side null = no comparison performed. Pre-migration rows
  // (cachedFingerprint null) keep their pre-Wave-2.3 trust shape; a
  // caller without an incoming fingerprint trivially can't compare.
  // Both-non-null + mismatch = the TxId-collision attack signature
  // OR a buggy caller; either way we don't trust the cache.
  if (
    cachedFingerprint !== null &&
    incomingFingerprint !== null &&
    cachedFingerprint !== incomingFingerprint
  ) {
    return { kind: 'fingerprint_mismatch', cachedFingerprint }
  }

  return {
    kind: 'hit',
    outcome: {
      status: Number(row.response_status),
      body: row.response_body as unknown,
    },
  }
}

export async function recordWebhookDelivery(opts: {
  provider: string
  kind: string
  transactionId: string
  invoiceId: string | null
  outcome: WebhookDeliveryOutcome
  requestFingerprint?: string | null
}): Promise<void> {
  const pool = getDbPool()
  // ON CONFLICT DO NOTHING — the rare race where two retries finish
  // at almost the same time. The first row wins; the second is
  // silently dropped here. The handler-side already produced both
  // (idempotent at the data layer per module-level comment).
  //
  // Note re: fingerprint mismatch: when an incoming request hits a
  // cached row with a DIFFERENT fingerprint, lookup returns
  // `fingerprint_mismatch`. The caller runs the handler and then
  // calls recordWebhookDelivery — which lands here, hits the same
  // PK, and goes nowhere (DO NOTHING). The first-cached fingerprint
  // stays. Acceptable: the legit second request was processed
  // correctly; only its outcome wasn't cached. A subsequent retry
  // of the legit request will ALSO mismatch the cache and re-process
  // (audit row duplicates, operator email duplicates). Bounded cost.
  // Making the fingerprint part of the PK would let the attacker
  // store BOTH outcomes — the attack vector. Trade-off chosen: legit
  // retry processed multiple times > attacker stores arbitrary fake
  // outcomes.
  await pool.query(
    `insert into webhook_deliveries (
      provider, kind, transaction_id, invoice_id,
      response_status, response_body, request_fingerprint
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    on conflict (provider, kind, transaction_id) do nothing`,
    [
      opts.provider,
      opts.kind,
      opts.transactionId,
      opts.invoiceId,
      opts.outcome.status,
      JSON.stringify(opts.outcome.body),
      opts.requestFingerprint ?? null,
    ],
  )
}

// Best-effort cleanup janitor. Webhook retention is 90 days — long
// enough to debug real production escalations without keeping the
// table unbounded. Mirrors `purgeStaleIdempotencyRecordsPostgres`.
export async function purgeStaleWebhookDeliveries(maxAgeDays = 90): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `delete from webhook_deliveries where received_at < now() - ($1::int || ' days')::interval`,
    [maxAgeDays],
  )
}

// Wave 3.2 — sticky-client variants for serialized processing.
//
// `handleCloudPaymentsWebhook` wraps lookup → handler → record in a
// single pg transaction holding `pg_advisory_xact_lock` keyed by
// `(provider, kind, transaction_id)`. A second concurrent retry that
// arrives while the first is mid-handler waits at the lock, then
// re-checks the cache after acquiring it — sees the row the first
// retry just committed and short-circuits. Result: handler runs
// exactly once per delivery, no duplicate operator email.
//
// These variants do the same work as the pool-based versions above
// but on a caller-supplied `PoolClient` so the lookup + record stay
// inside the lock-holding transaction. The pool-based versions stay
// for legacy / non-dedup paths and tests.

export async function lookupWebhookDeliveryClient(
  client: PoolClient,
  provider: string,
  kind: string,
  transactionId: string,
  incomingFingerprint: string | null = null,
): Promise<WebhookDeliveryLookup> {
  const result = await client.query(
    `select response_status, response_body, request_fingerprint
     from webhook_deliveries
     where provider = $1 and kind = $2 and transaction_id = $3`,
    [provider, kind, transactionId],
  )

  if (result.rows.length === 0) {
    return { kind: 'miss' }
  }

  const row = result.rows[0]
  const cachedFingerprint =
    row.request_fingerprint != null && row.request_fingerprint !== ''
      ? String(row.request_fingerprint)
      : null

  if (
    cachedFingerprint !== null &&
    incomingFingerprint !== null &&
    cachedFingerprint !== incomingFingerprint
  ) {
    return { kind: 'fingerprint_mismatch', cachedFingerprint }
  }

  return {
    kind: 'hit',
    outcome: {
      status: Number(row.response_status),
      body: row.response_body as unknown,
    },
  }
}

export async function recordWebhookDeliveryClient(
  client: PoolClient,
  opts: {
    provider: string
    kind: string
    transactionId: string
    invoiceId: string | null
    outcome: WebhookDeliveryOutcome
    requestFingerprint?: string | null
  },
): Promise<void> {
  await client.query(
    `insert into webhook_deliveries (
      provider, kind, transaction_id, invoice_id,
      response_status, response_body, request_fingerprint
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    on conflict (provider, kind, transaction_id) do nothing`,
    [
      opts.provider,
      opts.kind,
      opts.transactionId,
      opts.invoiceId,
      opts.outcome.status,
      JSON.stringify(opts.outcome.body),
      opts.requestFingerprint ?? null,
    ],
  )
}
