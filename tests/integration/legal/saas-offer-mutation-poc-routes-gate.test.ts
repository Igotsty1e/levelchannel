// Per-route gate-on integration tests for the 3 PoC migrated routes
// (wave-paranoia R1 WARN #3 closure 2026-06-05). Wrapper-level tests
// (saas-offer-mutation-wrapper.test.ts) prove the wrapper's contract;
// this file proves each route correctly wires the wrapper into an HTTP
// response when SAAS_OFFER_GATE_ENABLED=1 and the teacher lacks consent.
//
// Each route is exercised end-to-end (real HTTP shape via buildRequest
// + handler import) for the consent_required verdict; happy-path / 404
// / origin / rate-limit coverage stays in the existing route-level
// suites (teacher-invite-flow, conflict-actions, orphan-cleanup) which
// were verified to pass post-migration.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as revokeInviteHandler } from '@/app/api/teacher/invites/[id]/revoke/route'
import { POST as dismissConflictHandler } from '@/app/api/teacher/slots/[id]/dismiss-conflict/route'
import { POST as orphanIgnoreHandler } from '@/app/api/teacher/calendar/orphan-slots/ignore/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'poc-gate-test-secret-aaaaaaaaaaaaaaaaaa'
const SOME_UUID = '11111111-1111-1111-1111-111111111111'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
  delete process.env.SAAS_OFFER_GATE_ENABLED
})

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

async function seedLiveSaasOffer() {
  const pool = getAuthPool()
  for (const docKind of ['saas_offer', 'saas_processor_terms']) {
    await pool.query(
      `delete from account_consents where legal_document_version_id in (
         select id from legal_document_versions where doc_kind = $1
       )`,
      [docKind],
    )
    await pool.query(
      `delete from legal_document_versions where doc_kind = $1`,
      [docKind],
    )
    await pool.query(
      `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
       values ($1, 'pocv1', now() - interval '1 minute', $2)`,
      [docKind, `# body for ${docKind} pocv1`],
    )
  }
}

async function seedPlaceholderSaasOffer() {
  const pool = getAuthPool()
  await pool.query(
    `delete from legal_document_versions where doc_kind in ('saas_offer', 'saas_processor_terms')`,
  )
  await pool.query(
    `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md) values
     ('saas_offer', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p'),
     ('saas_processor_terms', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p')`,
  )
}

describe('PoC routes — gate ON + consent_required returns 403, NO side-effect', () => {
  it('invites/[id]/revoke — 403 saas_offer_consent_required', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedLiveSaasOffer()
      const teacher = await regTeacher('poc-revoke-noconsent@example.com')
      const r = await revokeInviteHandler(
        buildRequest(`/api/teacher/invites/${SOME_UUID}/revoke`, {
          cookie: teacher.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: SOME_UUID }) },
      )
      expect(r.status).toBe(403)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_consent_required')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('slots/[id]/dismiss-conflict — 403 saas_offer_consent_required (NOT 404 even on malformed UUID)', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedLiveSaasOffer()
      const teacher = await regTeacher('poc-dismiss-noconsent@example.com')
      // Use a malformed UUID — gate-first invariant: 403 surfaces BEFORE
      // the route's 404 not_found_or_no_conflict.
      const r = await dismissConflictHandler(
        buildRequest(`/api/teacher/slots/not-a-uuid/dismiss-conflict`, {
          cookie: teacher.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: 'not-a-uuid' }) },
      )
      expect(r.status).toBe(403)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_consent_required')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('calendar/orphan-slots/ignore — 403 saas_offer_consent_required (NOT 400 even on missing body fields)', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedLiveSaasOffer()
      const teacher = await regTeacher('poc-orphan-noconsent@example.com')
      // Missing both `all` and `slotId` — would 400 invalid_body in the
      // un-gated path. Gate-first: 403 must surface FIRST.
      const r = await orphanIgnoreHandler(
        buildRequest('/api/teacher/calendar/orphan-slots/ignore', {
          cookie: teacher.cookie,
          body: {},
        }),
      )
      expect(r.status).toBe(403)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_consent_required')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })
})

// Wave-paranoia R2 WARN closure (2026-06-05): 503 awaiting_publication
// half of the per-route real-HTTP coverage. Same shape as the 403
// suite above — proves each route correctly wires the wrapper's
// awaiting_publication branch into a 503 response.
describe('PoC routes — gate ON + awaiting_publication returns 503, NO side-effect', () => {
  it('invites/[id]/revoke — 503 saas_offer_awaiting_publication', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedPlaceholderSaasOffer()
      const teacher = await regTeacher('poc-revoke-awaiting@example.com')
      const r = await revokeInviteHandler(
        buildRequest(`/api/teacher/invites/${SOME_UUID}/revoke`, {
          cookie: teacher.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: SOME_UUID }) },
      )
      expect(r.status).toBe(503)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_awaiting_publication')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('slots/[id]/dismiss-conflict — 503 saas_offer_awaiting_publication (NOT 404 even on malformed UUID)', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedPlaceholderSaasOffer()
      const teacher = await regTeacher('poc-dismiss-awaiting@example.com')
      const r = await dismissConflictHandler(
        buildRequest(`/api/teacher/slots/not-a-uuid/dismiss-conflict`, {
          cookie: teacher.cookie,
          body: {},
        }),
        { params: Promise.resolve({ id: 'not-a-uuid' }) },
      )
      expect(r.status).toBe(503)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_awaiting_publication')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('calendar/orphan-slots/ignore — 503 saas_offer_awaiting_publication (NOT 400 even on missing body fields)', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedPlaceholderSaasOffer()
      const teacher = await regTeacher('poc-orphan-awaiting@example.com')
      const r = await orphanIgnoreHandler(
        buildRequest('/api/teacher/calendar/orphan-slots/ignore', {
          cookie: teacher.cookie,
          body: {},
        }),
      )
      expect(r.status).toBe(503)
      const body = await r.json()
      expect(body.error).toBe('saas_offer_awaiting_publication')
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })
})
