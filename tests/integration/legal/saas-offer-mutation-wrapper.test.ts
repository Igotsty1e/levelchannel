// Integration tests for requireTeacherWithMutationGate higher-order
// wrapper from `lib/auth/guards.ts` — plan §0af Closure for BLOCKER #6
// rollout helper. Verifies:
//   - Anon → 401 (passes through requireTeacherAndVerified).
//   - Non-teacher → 403.
//   - Teacher + gate flag OFF → callback runs + commits.
//   - Teacher + flag ON + no consent → 403 saas_offer_consent_required;
//     callback NEVER fires (TX rolled back).
//   - Teacher + flag ON + placeholder live → 503 saas_offer_awaiting_publication.
//   - Callback throw → rollback (no partial commits).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { recordConsent } from '@/lib/auth/consents'
import {
  MutationGateAbort,
  requireTeacherWithMutationGate,
  runInSaasOfferMutationGate,
} from '@/lib/auth/guards'
import { getAuthPool } from '@/lib/auth/pool'
import { buildCombinedVersion } from '@/lib/legal/combined-version'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'mwg-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
  delete process.env.SAAS_OFFER_GATE_ENABLED
})

async function reg(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student' } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function seedLiveVersion(
  docKind: 'saas_offer' | 'saas_processor_terms',
  versionLabel: string,
): Promise<{ id: string; versionLabel: string }> {
  const pool = getAuthPool()
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
  const r = await pool.query<{ id: string }>(
    `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
     values ($1, $2, now() - interval '1 minute', $3)
     returning id`,
    [docKind, versionLabel, `# body for ${docKind} ${versionLabel}`],
  )
  return { id: String(r.rows[0].id), versionLabel }
}

describe('requireTeacherWithMutationGate', () => {
  it('anonymous → 401 (no session cookie)', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const callback = vi.fn()
    const r = await requireTeacherWithMutationGate(
      buildRequest('/api/teacher/test', { body: {} }),
      callback,
    )
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(401)
    expect(callback).not.toHaveBeenCalled()
  })

  it('learner → 403 wrong_role (not a teacher)', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const learner = await reg('mwg-learner@example.com')
    const callback = vi.fn()
    const r = await requireTeacherWithMutationGate(
      buildRequest('/api/teacher/test', { cookie: learner.cookie, body: {} }),
      callback,
    )
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(403)
    expect(callback).not.toHaveBeenCalled()
  })

  it('teacher + gate flag OFF → callback runs + commits its work', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('mwg-flag-off@example.com', { role: 'teacher' })
    const inserted = await requireTeacherWithMutationGate(
      buildRequest('/api/teacher/test', { cookie: teacher.cookie, body: {} }),
      async (client) => {
        // Use a per-test scratch table — we just want to prove the
        // callback ran inside a TX that committed. Stamp the
        // account_onboarding_state row as a side-effect.
        await client.query(
          `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
           values ($1::uuid, jsonb_build_object('mwg_marker', 'flag_off'), now())
           on conflict (account_id) do update set
             dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints,
             updated_at = now()`,
          [teacher.accountId],
        )
        return { ok: true }
      },
    )
    expect(inserted).toEqual({ ok: true })

    const pool = getAuthPool()
    const r = await pool.query<{ dismissed_hints: Record<string, unknown> }>(
      `select dismissed_hints from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(r.rows[0]?.dismissed_hints).toMatchObject({ mwg_marker: 'flag_off' })
  })

  it('teacher + flag ON + no consent → 403 + callback never runs', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedLiveVersion('saas_offer', 'v1')
      await seedLiveVersion('saas_processor_terms', 'v1')
      const teacher = await reg('mwg-no-consent@example.com', { role: 'teacher' })
      const callback = vi.fn()
      const r = await requireTeacherWithMutationGate(
        buildRequest('/api/teacher/test', { cookie: teacher.cookie, body: {} }),
        callback,
      )
      expect(r).toBeInstanceOf(Response)
      expect((r as Response).status).toBe(403)
      const body = await (r as Response).json()
      expect(body.error).toBe('saas_offer_consent_required')
      expect(callback).not.toHaveBeenCalled()
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('teacher + flag ON + placeholder live → 503 + callback never runs', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      const pool = getAuthPool()
      // Wipe all rows then insert ONLY the placeholder so gate sees awaiting_publication.
      await pool.query(
        `delete from legal_document_versions where doc_kind in ('saas_offer', 'saas_processor_terms')`,
      )
      await pool.query(
        `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md) values
         ('saas_offer', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p'),
         ('saas_processor_terms', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p')`,
      )
      const teacher = await reg('mwg-placeholder@example.com', { role: 'teacher' })
      const callback = vi.fn()
      const r = await requireTeacherWithMutationGate(
        buildRequest('/api/teacher/test', { cookie: teacher.cookie, body: {} }),
        callback,
      )
      expect(r).toBeInstanceOf(Response)
      expect((r as Response).status).toBe(503)
      const body = await (r as Response).json()
      expect(body.error).toBe('saas_offer_awaiting_publication')
      expect(callback).not.toHaveBeenCalled()
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('callback throw → TX rolled back, no partial commits', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('mwg-throw@example.com', { role: 'teacher' })
    await expect(
      requireTeacherWithMutationGate(
        buildRequest('/api/teacher/test', { cookie: teacher.cookie, body: {} }),
        async (client) => {
          await client.query(
            `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
             values ($1::uuid, jsonb_build_object('mwg_throw_marker', 'should_rollback'), now())
             on conflict (account_id) do update set
               dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints`,
            [teacher.accountId],
          )
          throw new Error('synthetic test throw')
        },
      ),
    ).rejects.toThrow('synthetic test throw')

    const pool = getAuthPool()
    const r = await pool.query<{ count: string }>(
      `select count(*)::text as count from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(r.rows[0]?.count).toBe('0')
  })

  it('teacher + flag ON + matching consent + valid callback → commits both halves', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      const offer = await seedLiveVersion('saas_offer', 'v1')
      const terms = await seedLiveVersion('saas_processor_terms', 'v1')
      const teacher = await reg('mwg-ok@example.com', { role: 'teacher' })
      await recordConsent({
        accountId: teacher.accountId,
        documentKind: 'saas_offer',
        documentVersion: buildCombinedVersion(offer.versionLabel, terms.versionLabel),
        documentPath: '/saas/offer',
        legalDocumentVersionId: offer.id,
        ip: null,
        userAgent: null,
      })
      const result = await requireTeacherWithMutationGate(
        buildRequest('/api/teacher/test', { cookie: teacher.cookie, body: {} }),
        async (client) => {
          await client.query(
            `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
             values ($1::uuid, jsonb_build_object('mwg_ok_marker', 'flag_on'), now())
             on conflict (account_id) do update set
               dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints,
               updated_at = now()`,
            [teacher.accountId],
          )
          return { committed: true }
        },
      )
      expect(result).toEqual({ committed: true })
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })
})

// saas-offer-mutation-wrapper-poc (2026-06-04, plan §0a-2 + §0b-2):
// `runInSaasOfferMutationGate(accountId, fn)` is the 2-step split half
// that does ONLY the TX + gate + run-callback (no auth). Caller
// authenticates first, then rate-limits, then runs the gate.
describe('runInSaasOfferMutationGate (2-step split)', () => {
  it('teacher + gate flag OFF → callback runs + commits', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('rgate-off@example.com', { role: 'teacher' })
    const r = await runInSaasOfferMutationGate(teacher.accountId, async (client) => {
      await client.query(
        `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
         values ($1::uuid, jsonb_build_object('rgate_marker', 'flag_off'), now())
         on conflict (account_id) do update set
           dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints,
           updated_at = now()`,
        [teacher.accountId],
      )
      return { rgate: 'ok' }
    })
    expect(r).toEqual({ rgate: 'ok' })

    const pool = getAuthPool()
    const check = await pool.query<{ dismissed_hints: Record<string, unknown> }>(
      `select dismissed_hints from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(check.rows[0]?.dismissed_hints).toMatchObject({ rgate_marker: 'flag_off' })
  })

  it('teacher + flag ON + no consent → 403 + callback never runs', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      await seedLiveVersion('saas_offer', 'rv1')
      await seedLiveVersion('saas_processor_terms', 'rv1')
      const teacher = await reg('rgate-no-consent@example.com', { role: 'teacher' })
      const callback = vi.fn()
      const r = await runInSaasOfferMutationGate(teacher.accountId, callback)
      expect(r).toBeInstanceOf(Response)
      expect((r as Response).status).toBe(403)
      const body = await (r as Response).json()
      expect(body.error).toBe('saas_offer_consent_required')
      expect(callback).not.toHaveBeenCalled()
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('teacher + flag ON + placeholder live → 503 + callback never runs', async () => {
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    try {
      const pool = getAuthPool()
      await pool.query(
        `delete from legal_document_versions where doc_kind in ('saas_offer', 'saas_processor_terms')`,
      )
      await pool.query(
        `insert into legal_document_versions (doc_kind, version_label, effective_from, body_md) values
         ('saas_offer', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p'),
         ('saas_processor_terms', 'v0-placeholder-do-not-accept', now() - interval '1 minute', 'p')`,
      )
      const teacher = await reg('rgate-placeholder@example.com', { role: 'teacher' })
      const callback = vi.fn()
      const r = await runInSaasOfferMutationGate(teacher.accountId, callback)
      expect(r).toBeInstanceOf(Response)
      expect((r as Response).status).toBe(503)
      const body = await (r as Response).json()
      expect(body.error).toBe('saas_offer_awaiting_publication')
      expect(callback).not.toHaveBeenCalled()
    } finally {
      delete process.env.SAAS_OFFER_GATE_ENABLED
    }
  })

  it('MutationGateAbort thrown from callback → returns carried response, TX rolled back', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('rgate-abort@example.com', { role: 'teacher' })
    const r = await runInSaasOfferMutationGate(teacher.accountId, async (client) => {
      // Side-effect that MUST be rolled back when sentinel throws.
      await client.query(
        `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
         values ($1::uuid, jsonb_build_object('abort_marker', 'should_rollback'), now())
         on conflict (account_id) do update set
           dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints`,
        [teacher.accountId],
      )
      throw MutationGateAbort.fromJson(
        { error: 'not_found', message: 'sentinel test' },
        { status: 404 },
      )
    })
    expect(r).toBeInstanceOf(Response)
    expect((r as Response).status).toBe(404)
    const body = await (r as Response).json()
    expect(body.error).toBe('not_found')

    // Side-effect MUST NOT have persisted (rollback).
    const pool = getAuthPool()
    const check = await pool.query<{ count: string }>(
      `select count(*)::text as count from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(check.rows[0]?.count).toBe('0')
  })

  it('callback returns {ok:false} → wrapper COMMITS (no rollback); only sentinel throws roll back', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('rgate-return-false@example.com', { role: 'teacher' })
    const r = await runInSaasOfferMutationGate(teacher.accountId, async (client) => {
      await client.query(
        `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
         values ($1::uuid, jsonb_build_object('return_false_marker', 'committed'), now())
         on conflict (account_id) do update set
           dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints`,
        [teacher.accountId],
      )
      // Helper signals failure via return value — wrapper still commits.
      return { ok: false as const }
    })
    expect(r).toEqual({ ok: false })

    // Side-effect MUST have persisted (commit semantics).
    const pool = getAuthPool()
    const check = await pool.query<{ dismissed_hints: Record<string, unknown> }>(
      `select dismissed_hints from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(check.rows[0]?.dismissed_hints).toMatchObject({ return_false_marker: 'committed' })
  })

  it('non-sentinel throw → wrapper rolls back AND re-throws', async () => {
    delete process.env.SAAS_OFFER_GATE_ENABLED
    const teacher = await reg('rgate-generic-throw@example.com', { role: 'teacher' })
    await expect(
      runInSaasOfferMutationGate(teacher.accountId, async (client) => {
        await client.query(
          `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
           values ($1::uuid, jsonb_build_object('generic_throw_marker', 'should_rollback'), now())
           on conflict (account_id) do update set
             dismissed_hints = account_onboarding_state.dismissed_hints || excluded.dismissed_hints`,
          [teacher.accountId],
        )
        throw new Error('synthetic generic throw')
      }),
    ).rejects.toThrow('synthetic generic throw')

    const pool = getAuthPool()
    const check = await pool.query<{ count: string }>(
      `select count(*)::text as count from account_onboarding_state where account_id = $1`,
      [teacher.accountId],
    )
    expect(check.rows[0]?.count).toBe('0')
  })
})
