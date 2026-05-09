import { describe, expect, it } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { listAccountConsents } from '@/lib/auth/consents'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import {
  getCurrentLegalVersion,
  getLegalVersionById,
  listLegalVersions,
} from '@/lib/legal/versions'

import '../setup'
import { buildRequest } from '../helpers'

// Legal-versioning sister wave — minimum viable evidence chain.
// Pins:
//   - migration 0032 seeded v1 rows for offer / privacy / personal_data
//   - getCurrentLegalVersion picks the latest effective_from <= now()
//   - new consents on register flow carry legal_document_version_id

describe('legal-versioning seed (migration 0032)', () => {
  it('seeded v1 rows exist for all three doc kinds', async () => {
    const pool = getDbPool()
    const result = await pool.query(
      `select doc_kind, version_label
         from legal_document_versions
        order by doc_kind`,
    )
    const map = new Map<string, string>()
    for (const r of result.rows) {
      map.set(String(r.doc_kind), String(r.version_label))
    }
    expect(map.get('offer')).toBe('v1')
    expect(map.get('privacy')).toBe('v1')
    expect(map.get('personal_data')).toBe('v1')
  })

  it('getCurrentLegalVersion returns the seeded v1 for each kind', async () => {
    for (const kind of ['offer', 'privacy', 'personal_data'] as const) {
      const v = await getCurrentLegalVersion(kind)
      expect(v).not.toBeNull()
      expect(v!.docKind).toBe(kind)
      expect(v!.versionLabel).toBe('v1')
      expect(v!.bodyMd.length).toBeGreaterThan(0)
    }
  })

  it('getLegalVersionById returns the same row by id', async () => {
    const cur = await getCurrentLegalVersion('offer')
    expect(cur).not.toBeNull()
    const byId = await getLegalVersionById(cur!.id)
    expect(byId).not.toBeNull()
    expect(byId!.id).toBe(cur!.id)
    expect(byId!.docKind).toBe('offer')
  })

  it('listLegalVersions returns ordered list (most-recent first)', async () => {
    const list = await listLegalVersions('offer')
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].docKind).toBe('offer')
  })

  it('a future-dated version is NOT returned by getCurrentLegalVersion', async () => {
    const pool = getDbPool()
    // Insert a future v2 of `offer`. Cleanup at end so we don't
    // pollute the v1 seed for follow-up tests in this file —
    // setup.ts does not truncate legal_document_versions because
    // the seed rows are migration-installed (not test fixtures).
    await pool.query(
      `insert into legal_document_versions
         (doc_kind, version_label, effective_from, body_md)
       values ($1, $2, $3, $4)`,
      ['offer', 'v-future', '2099-01-01T00:00:00Z', '# Future text'],
    )
    try {
      const cur = await getCurrentLegalVersion('offer')
      expect(cur).not.toBeNull()
      // Latest still-effective row should be v1, not v-future.
      expect(cur!.versionLabel).toBe('v1')
      // listLegalVersions includes the future row but cur skips it.
      const list = await listLegalVersions('offer')
      expect(list.some((v) => v.versionLabel === 'v-future')).toBe(true)
      expect(list[0].versionLabel).toBe('v-future') // ordered by effective_from desc
    } finally {
      await pool.query(
        `delete from legal_document_versions
          where doc_kind = $1 and version_label = $2`,
        ['offer', 'v-future'],
      )
    }
  })
})

describe('register flow captures legal_document_version_id', () => {
  it('new account consent has legalDocumentVersionId = current personal_data version', async () => {
    const email = 'lvw-register@example.com'
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
      }),
    )
    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()
    const consents = await listAccountConsents(account!.id)
    const personalData = consents.find((c) => c.documentKind === 'personal_data')
    expect(personalData).toBeDefined()
    const cur = await getCurrentLegalVersion('personal_data')
    expect(cur).not.toBeNull()
    expect(personalData!.legalDocumentVersionId).toBe(cur!.id)
  })
})
