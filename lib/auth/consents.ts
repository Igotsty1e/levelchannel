import { randomUUID } from 'node:crypto'

import { getAuthPool } from '@/lib/auth/pool'

export type ConsentKind =
  | 'personal_data'
  | 'offer'
  | 'marketing_opt_in'
  | 'parent_consent'

export type AccountConsent = {
  id: string
  accountId: string
  documentKind: ConsentKind
  documentVersion: string
  documentPath: string | null
  acceptedAt: string
  ip: string | null
  userAgent: string | null
  createdAt: string
}

function rowToConsent(row: Record<string, unknown>): AccountConsent {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    documentKind: String(row.document_kind) as ConsentKind,
    documentVersion: String(row.document_version),
    documentPath: row.document_path ? String(row.document_path) : null,
    acceptedAt: new Date(String(row.accepted_at)).toISOString(),
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

export async function recordConsent(params: {
  accountId: string
  documentKind: ConsentKind
  documentVersion: string
  documentPath?: string | null
  ip?: string | null
  userAgent?: string | null
  acceptedAt?: string
}): Promise<AccountConsent> {
  const pool = getAuthPool()
  const id = randomUUID()
  const acceptedAt = params.acceptedAt || new Date().toISOString()

  const result = await pool.query(
    `insert into account_consents
       (id, account_id, document_kind, document_version, document_path, accepted_at, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, account_id, document_kind, document_version, document_path,
               accepted_at, ip, user_agent, created_at`,
    [
      id,
      params.accountId,
      params.documentKind,
      params.documentVersion,
      params.documentPath || null,
      acceptedAt,
      params.ip || null,
      params.userAgent || null,
    ],
  )

  return rowToConsent(result.rows[0])
}

export async function listAccountConsents(
  accountId: string,
): Promise<AccountConsent[]> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, account_id, document_kind, document_version, document_path,
            accepted_at, ip, user_agent, created_at
     from account_consents
     where account_id = $1
     order by accepted_at desc`,
    [accountId],
  )
  return result.rows.map(rowToConsent)
}

export async function getLatestConsent(
  accountId: string,
  documentKind: ConsentKind,
): Promise<AccountConsent | null> {
  const pool = getAuthPool()
  const result = await pool.query(
    `select id, account_id, document_kind, document_version, document_path,
            accepted_at, ip, user_agent, created_at
     from account_consents
     where account_id = $1 and document_kind = $2
     order by accepted_at desc
     limit 1`,
    [accountId, documentKind],
  )
  return result.rows[0] ? rowToConsent(result.rows[0]) : null
}
