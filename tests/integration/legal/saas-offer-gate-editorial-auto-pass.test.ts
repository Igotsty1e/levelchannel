// Editorial chain auto-pass (mig 0116):
// when a teacher has consent on row N and the currently-live row is an
// editorial successor of N, evaluateSaasOfferGate must return `ok`
// without forcing re-acceptance. Material successors still require it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAuthPool } from '@/lib/auth/pool'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'

import '../setup'

const ENV_KEY = 'SAAS_OFFER_GATE_ENABLED'

beforeAll(() => {
  process.env[ENV_KEY] = '1'
})

afterAll(() => {
  delete process.env[ENV_KEY]
})

async function seedTeacherWithConsent(opts: {
  offerLabel: string
  offerChangeKind?: 'material' | 'editorial'
  consentLabel: string
  termsLabel: string
}): Promise<{ accountId: string }> {
  const pool = getAuthPool()
  // Wipe and seed both legal kinds.
  await pool.query(`delete from legal_document_versions where doc_kind in ('saas_offer', 'saas_processor_terms')`)

  // Seed initial material offer + its consented version.
  const consentRow = await pool.query<{ id: string }>(
    `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md, change_kind)
     values ('saas_offer', $1, now() - interval '2 hours', $2, 'material')
     returning id`,
    [opts.consentLabel, `# saas_offer body for ${opts.consentLabel}`],
  )
  const consentVersionId = consentRow.rows[0].id

  // Seed the «live» offer (could be the same as consent or a successor).
  let liveVersionId = consentVersionId
  if (opts.offerLabel !== opts.consentLabel) {
    const live = await pool.query<{ id: string }>(
      `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md,
                                            previous_version_id, change_kind)
       values ('saas_offer', $1, now() - interval '1 minute', $2, $3, $4)
       returning id`,
      [
        opts.offerLabel,
        `# saas_offer body for ${opts.offerLabel}`,
        consentVersionId,
        opts.offerChangeKind ?? 'editorial',
      ],
    )
    liveVersionId = live.rows[0].id
  }

  // Seed terms (single version, label matches both consent and live).
  await pool.query(
    `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md, change_kind)
     values ('saas_processor_terms', $1, now() - interval '2 hours', $2, 'material')`,
    [opts.termsLabel, `# terms body for ${opts.termsLabel}`],
  )

  // Seed teacher account + consent on the original material row.
  const acc = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at, created_at, updated_at)
     values ('teacher-' || gen_random_uuid() || '@editorial-test', 'x', now(), now(), now())
     returning id`,
  )
  const accountId = acc.rows[0].id
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [accountId],
  )
  await pool.query(
    `insert into account_consents
       (account_id, document_kind, document_version, legal_document_version_id, accepted_at)
     values ($1, 'saas_offer', $2, $3, now())`,
    [
      accountId,
      `saas_offer:${opts.consentLabel}+processor_terms:${opts.termsLabel}`,
      consentVersionId,
    ],
  )
  return { accountId }
}

describe('evaluateSaasOfferGate — editorial auto-pass (mig 0116)', () => {
  it('returns ok when the live offer is an editorial successor of the consented row', async () => {
    const { accountId } = await seedTeacherWithConsent({
      consentLabel: 'v1-2026-06-01',
      offerLabel: 'v1-2026-06-08-editorial',
      offerChangeKind: 'editorial',
      termsLabel: 'v1-terms',
    })
    const verdict = await evaluateSaasOfferGate(accountId)
    expect(verdict.kind).toBe('ok')
  })

  it('returns consent_required when the successor is material (not editorial)', async () => {
    const { accountId } = await seedTeacherWithConsent({
      consentLabel: 'v1-2026-06-01',
      offerLabel: 'v2-2026-07-01',
      offerChangeKind: 'material',
      termsLabel: 'v1-terms',
    })
    const verdict = await evaluateSaasOfferGate(accountId)
    expect(verdict.kind).toBe('consent_required')
  })

  it('returns ok when live offer label matches the consented label (no chain walk needed)', async () => {
    const { accountId } = await seedTeacherWithConsent({
      consentLabel: 'v1-2026-06-01',
      offerLabel: 'v1-2026-06-01',
      termsLabel: 'v1-terms',
    })
    const verdict = await evaluateSaasOfferGate(accountId)
    expect(verdict.kind).toBe('ok')
  })
})
