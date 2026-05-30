// Legal-versioning data layer (sister wave to billing).
//
// Lookup-current and reference-from-consent shape — the minimum viable
// surface required by Codex round 1 HIGH 6 of the billing-wave design:
// every consent / purchase row must point to the EXACT version of the
// document that was effective at the time of acceptance.
//
// Out of scope here (follow-up): version creation/edit (admin UI),
// material-change notifications, public history routes, diff render.

import { getDbPool } from '@/lib/db/pool'

export type LegalDocKind =
  | 'offer'
  | 'privacy'
  | 'personal_data'
  | 'saas_offer'

export type LegalDocumentVersion = {
  id: string
  docKind: LegalDocKind
  versionLabel: string
  effectiveFrom: string
  bodyMd: string
  previousVersionId: string | null
  createdAt: string
  createdByAccountId: string | null
}

const COLS =
  'id, doc_kind, version_label, effective_from, body_md, previous_version_id, created_at, created_by_account_id'

function rowToVersion(row: Record<string, unknown>): LegalDocumentVersion {
  return {
    id: String(row.id),
    docKind: String(row.doc_kind) as LegalDocKind,
    versionLabel: String(row.version_label),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    bodyMd: String(row.body_md),
    previousVersionId: row.previous_version_id
      ? String(row.previous_version_id)
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    createdByAccountId: row.created_by_account_id
      ? String(row.created_by_account_id)
      : null,
  }
}

// Returns the latest version of `kind` whose `effective_from <= now()`.
// Null if no version exists yet (should never happen post-migration —
// seed rows ship in 0032 — but defensive for fresh test DBs).
export async function getCurrentLegalVersion(
  kind: LegalDocKind,
): Promise<LegalDocumentVersion | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${COLS}
       from legal_document_versions
      where doc_kind = $1
        and effective_from <= now()
      order by effective_from desc, created_at desc
      limit 1`,
    [kind],
  )
  return result.rows[0] ? rowToVersion(result.rows[0]) : null
}

// Look up by id (used when reading a specific consent's version
// snapshot for an audit / dispute). Null on not-found.
export async function getLegalVersionById(
  id: string,
): Promise<LegalDocumentVersion | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${COLS} from legal_document_versions where id = $1`,
    [id],
  )
  return result.rows[0] ? rowToVersion(result.rows[0]) : null
}

// All versions of a kind ordered most-recent first. Powers a future
// /offer/history public route. Capped at a sensible upper bound; in
// practice versions per kind will be single-digit count.
export async function listLegalVersions(
  kind: LegalDocKind,
  limit = 50,
): Promise<LegalDocumentVersion[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${COLS}
       from legal_document_versions
      where doc_kind = $1
      order by effective_from desc, created_at desc
      limit $2`,
    [kind, Math.min(Math.max(limit, 1), 200)],
  )
  return result.rows.map((r) => rowToVersion(r as Record<string, unknown>))
}

// Wave 19 — operator publishes a new version. The previous-version
// chain MUST stay strictly linear, including under (a) concurrent
// admin sessions and (b) future-dated `effective_from`.
//
// Codex round 1 BLOCK (CRITICAL): SELECT ... FOR UPDATE LIMIT 1 does
// NOT serialize correctly in PostgreSQL READ COMMITTED. Two txns can
// wait on the same "current" row, both proceed after the lock
// releases, both insert with the SAME `previous_version_id` — fork
// the chain into a DAG. Fix: pg_advisory_xact_lock(hashtext('legal:'+kind))
// at the start of the txn serializes ALL publishes per docKind.
//
// Codex round 1 HIGH: previous = "latest live (effective_from <= now())"
// forks even without concurrency if the operator publishes v2
// (effective_from = tomorrow) followed by v3 (day-after); both would
// point at v1. Fix: previous = the row with the greatest
// (effective_from, created_at) regardless of whether it has gone live
// yet. Combined with the advisory lock, the chain is strictly linear
// by publish order.
//
// `effective_from` defaults to now(); operators rarely need a future
// date but the surface accepts it for cases like "оферта v3 действует
// с понедельника 9:00 МСК".
export async function createLegalVersion(input: {
  docKind: LegalDocKind
  versionLabel: string
  bodyMd: string
  effectiveFrom?: Date
  createdByAccountId: string
}): Promise<LegalDocumentVersion> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Per-kind advisory lock. Held for the duration of the txn,
    // released automatically on commit/rollback. hashtext gives a
    // stable int4 key from the kind string. Other publishes for the
    // same kind wait here; different kinds run in parallel.
    await client.query(
      `select pg_advisory_xact_lock(hashtext($1))`,
      [`legal:${input.docKind}`],
    )
    // Previous pointer: greatest (effective_from, created_at) across
    // ALL rows for the kind, regardless of live state. Future-dated
    // publishes chain correctly.
    const cur = await client.query(
      `select id from legal_document_versions
        where doc_kind = $1
        order by effective_from desc, created_at desc
        limit 1`,
      [input.docKind],
    )
    const previousVersionId = cur.rows[0] ? String(cur.rows[0].id) : null
    const inserted = await client.query(
      `insert into legal_document_versions
         (doc_kind, version_label, effective_from, body_md,
          previous_version_id, created_by_account_id)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLS}`,
      [
        input.docKind,
        input.versionLabel,
        input.effectiveFrom ?? new Date(),
        input.bodyMd,
        previousVersionId,
        input.createdByAccountId,
      ],
    )
    await client.query('commit')
    return rowToVersion(inserted.rows[0])
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
