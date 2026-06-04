// Integration tests for evaluateSaasOfferGateForMutation —
// §0af Closure for BLOCKER #6 (Class C race) verification.
//
// Focused on the verdict shape under the four documented states. The
// gate flag is forced via env var (resolveOperatorSetting honours
// `SAAS_OFFER_GATE_ENABLED` env over DB → default).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { recordConsent } from '@/lib/auth/consents'
import { evaluateSaasOfferGateForMutation } from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { buildCombinedVersion } from '@/lib/legal/combined-version'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'gate-mutation-test-auth-rate-limit-secret-aaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
  process.env.SAAS_OFFER_GATE_ENABLED = '1'
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
  delete process.env.SAAS_OFFER_GATE_ENABLED
})

// We don't add our own afterEach — setup.ts's TRUNCATE accounts
// CASCADE clears account_consents and (transitively, via the
// created_by_account_id FK) every legal_document_versions row that
// was inserted with a non-null creator. Mig 0096/0097 placeholder
// rows survive because they have created_by_account_id IS NULL.
//
// seedLiveVersion below DELETES non-placeholder rows for the kind
// before inserting so test ordering can't cause a unique-label
// collision.

async function seedLiveVersion(
  docKind: 'saas_offer' | 'saas_processor_terms',
  versionLabel: string,
): Promise<{ id: string; versionLabel: string }> {
  const pool = getAuthPool()
  // Drop ALL rows for this kind (including the migration's placeholder
  // seed) so the inserted row is unambiguously the latest live version.
  // FK chain: account_consents → legal_document_versions, so consent
  // rows pointing at older versions must go first.
  await pool.query(
    `delete from account_consents
       where legal_document_version_id in (
         select id from legal_document_versions where doc_kind = $1
       )`,
    [docKind],
  )
  await pool.query(
    `delete from legal_document_versions where doc_kind = $1`,
    [docKind],
  )
  const r = await pool.query<{ id: string }>(
    `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
     values ($1, $2, now() - interval '1 minute', $3)
     returning id`,
    [docKind, versionLabel, `# ${docKind} body for tests (${versionLabel})`],
  )
  return { id: String(r.rows[0].id), versionLabel }
}

async function regTeacher(email: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'teacher', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function runInTx<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getAuthPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('rollback')
    return result
  } finally {
    client.release()
  }
}

describe('evaluateSaasOfferGateForMutation', () => {
  it('returns awaiting_publication when live saas_offer is placeholder (default mig 0096 seed)', async () => {
    // mig 0096 + 0097 placeholder rows survive setup.ts's accounts
    // truncate (their created_by_account_id IS NULL). The gate must
    // treat `v0-placeholder-*` labels as awaiting_publication.
    const teacher = await regTeacher('soa-gate-mut-placeholder@example.com')
    const verdict = await runInTx((client) =>
      evaluateSaasOfferGateForMutation(client, teacher.accountId),
    )
    expect(verdict).toEqual({ kind: 'awaiting_publication' })
  })

  it('returns consent_required when no consent row exists', async () => {
    await seedLiveVersion('saas_offer', 'v1')
    await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-gate-mut-no-consent@example.com')
    const verdict = await runInTx((client) =>
      evaluateSaasOfferGateForMutation(client, teacher.accountId),
    )
    expect(verdict).toEqual({ kind: 'consent_required' })
  })

  it('returns ok when combinedVersion matches both live labels', async () => {
    const offer = await seedLiveVersion('saas_offer', 'v1')
    const terms = await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-gate-mut-ok@example.com')
    await recordConsent({
      accountId: teacher.accountId,
      documentKind: 'saas_offer',
      documentVersion: buildCombinedVersion(offer.versionLabel, terms.versionLabel),
      documentPath: '/saas/offer',
      legalDocumentVersionId: offer.id,
      ip: null,
      userAgent: null,
    })
    const verdict = await runInTx((client) =>
      evaluateSaasOfferGateForMutation(client, teacher.accountId),
    )
    expect(verdict).toEqual({ kind: 'ok' })
  })

  it('returns consent_required when saas_offer label drifted after publish-v2', async () => {
    const offer = await seedLiveVersion('saas_offer', 'v1')
    const terms = await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-gate-mut-drift@example.com')
    await recordConsent({
      accountId: teacher.accountId,
      documentKind: 'saas_offer',
      documentVersion: buildCombinedVersion(offer.versionLabel, terms.versionLabel),
      documentPath: '/saas/offer',
      legalDocumentVersionId: offer.id,
      ip: null,
      userAgent: null,
    })
    // Simulate publish-v2 of saas_offer (effective_from later than v1).
    await getAuthPool().query(
      `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
       values ('saas_offer', 'v2', now(), 'v2 body')`,
    )
    const verdict = await runInTx((client) =>
      evaluateSaasOfferGateForMutation(client, teacher.accountId),
    )
    expect(verdict).toEqual({ kind: 'consent_required' })
  })

  it('returns ok regardless of consent when the gate flag is OFF', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '0'
    try {
      const teacher = await regTeacher('soa-gate-mut-flag-off@example.com')
      const verdict = await runInTx((client) =>
        evaluateSaasOfferGateForMutation(client, teacher.accountId),
      )
      expect(verdict).toEqual({ kind: 'ok' })
    } finally {
      process.env.SAAS_OFFER_GATE_ENABLED = '1'
    }
  })
})
