// Integration tests for POST /api/teacher/saas-offer-accept —
// two-document TOCTOU contract (§0af Closure for BLOCKER #4) +
// combinedVersion encoding (§0af Closure for BLOCKER #1) +
// `auth.teacher.saas_offer_accepted` audit emit (§0ac Closure #7).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as acceptHandler } from '@/app/api/teacher/saas-offer-accept/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import { parseCombinedVersion } from '@/lib/legal/combined-version'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'saas-offer-accept-test-auth-rate-limit-secret-aaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
})

type LegalVersion = { id: string; versionLabel: string }

async function seedLiveVersion(
  docKind: 'saas_offer' | 'saas_processor_terms',
  versionLabel: string,
): Promise<LegalVersion> {
  const pool = getAuthPool()
  // Wipe ALL pre-existing rows for this kind (including any placeholder
  // seeded by migrations 0096/0097 — getCurrentLegalVersion picks the
  // greatest effective_from, so a stale placeholder with a newer
  // effective_from would shadow our non-placeholder seed). The accept
  // route reads getCurrentLegalVersion which order-bys effective_from
  // desc + created_at desc, so clearing the table for this kind is the
  // only deterministic setup.
  await pool.query(`delete from legal_document_versions where doc_kind = $1`, [
    docKind,
  ])
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
    email,
  }
}

describe('POST /api/teacher/saas-offer-accept — two-document TOCTOU', () => {
  it('writes single consent row with combinedVersion when both ids match live', async () => {
    const offer = await seedLiveVersion('saas_offer', 'v1')
    const terms = await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-accept-ok@example.com')

    const r = await acceptHandler(
      buildRequest('/api/teacher/saas-offer-accept', {
        cookie: teacher.cookie,
        body: {
          saasOfferConsentVersionId: offer.id,
          saasProcessorTermsConsentVersionId: terms.id,
        },
      }),
    )
    expect(r.status).toBe(200)

    const pool = getAuthPool()
    const consent = await pool.query<{
      document_version: string
      legal_document_version_id: string
    }>(
      `select document_version, legal_document_version_id
         from account_consents
        where account_id = $1::uuid
          and document_kind = 'saas_offer'
          and revoked_at is null
        order by accepted_at desc
        limit 1`,
      [teacher.accountId],
    )
    expect(consent.rows).toHaveLength(1)
    expect(consent.rows[0].legal_document_version_id).toBe(offer.id)
    const parsed = parseCombinedVersion(consent.rows[0].document_version)
    expect(parsed).toEqual({ saasOfferLabel: 'v1', processorTermsLabel: 'v1' })

    // Audit emit (§0ac Closure #7).
    const audit = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from auth_audit_events
        where event_type = 'auth.teacher.saas_offer_accepted'
          and account_id = $1::uuid
        order by created_at desc limit 1`,
      [teacher.accountId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].payload).toMatchObject({
      saas_offer_version_id: offer.id,
      saas_offer_label: 'v1',
      saas_processor_terms_version_id: terms.id,
      saas_processor_terms_label: 'v1',
    })
  })

  it('rejects with 400 when saas_processor_terms id is missing', async () => {
    const offer = await seedLiveVersion('saas_offer', 'v1')
    await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-accept-missing-terms@example.com')

    const r = await acceptHandler(
      buildRequest('/api/teacher/saas-offer-accept', {
        cookie: teacher.cookie,
        body: { saasOfferConsentVersionId: offer.id },
      }),
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('saas_processor_terms_version_missing')
  })

  it('rejects with 409 + drifted object when saas_processor_terms id stale', async () => {
    const offer = await seedLiveVersion('saas_offer', 'v1')
    await seedLiveVersion('saas_processor_terms', 'v1')
    const teacher = await regTeacher('soa-accept-drift@example.com')

    const r = await acceptHandler(
      buildRequest('/api/teacher/saas-offer-accept', {
        cookie: teacher.cookie,
        body: {
          saasOfferConsentVersionId: offer.id,
          saasProcessorTermsConsentVersionId:
            '00000000-0000-0000-0000-000000000000',
        },
      }),
    )
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toBe('saas_offer_version_changed')
    expect(body.drifted).toEqual({
      saas_offer: false,
      saas_processor_terms: true,
    })
  })
})
