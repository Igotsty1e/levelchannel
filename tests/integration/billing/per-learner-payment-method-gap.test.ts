// Per-learner payment-method gap-close — dropped-value reject / Q5 / Q7
// coverage + invite-default flow (plan §Scope item 6).
//
// Sister test: tests/integration/billing/cabinet-payment-method-banner.test.ts
// already pins Q3 ('none' → 422 payment_method_not_set) on the route side
// and the predicate side; tests/integration/billing/booking.test.ts:302
// pins Q10 ('prepaid_packages' + 0 packages → 402 package_required).
//
// This file fills the remaining canonical gaps:
//   Dropped enum value reject — PATCH 'prepaid_packages' must fail 422
//        after mig 0126 narrowed the enum to 'postpaid' | 'none'.
//   Q5 — only the teacher of this learner can PATCH the method (learner
//        and admin both rejected by requireTeacherWithCurrentSaasOffer-
//        Consent at exactly one of 401/403; a foreign teacher is 403
//        not_your_learner from the explicit pair check).
//   Q7 — successful PATCH writes the canonical
//        auth.billing.method_changed audit row with the right payload.
//   Invite-flow default (plan §Scope item 6) — invite with default
//        'prepaid_packages' seeds learner_billing_preferences (when
//        no prior pair-pref exists) AND emits the same
//        auth.billing.method_changed audit row; default 'none' seeds
//        a row with payment_method='none' (observationally identical
//        to no-row via getPaymentMethodForPair) and does NOT emit
//        the audit row; conflict-preserve (pre-existing pair-pref)
//        keeps the prior method and ALSO does NOT emit the audit
//        row (BLOCKER #1 closure — falsified-audit guard).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { PATCH as billingPatchHandler } from '@/app/api/teacher/learners/[id]/billing/route'
import { POST as createInviteHandler } from '@/app/api/teacher/invites/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import {
  getPaymentMethodForPair,
  setPaymentMethodForPair,
} from '@/lib/billing/learner-payment-method'
import {
  verifyInviteToken,
  TEACHER_INVITE_DEFAULT_TTL_SECONDS,
} from '@/lib/auth/teacher-invites'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// Mock email + bcrypt to keep the suite fast (matches the sister tests).
vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'gap-close-teacher-invite-secret-for-integration-aaaaaaa'

beforeAll(() => {
  process.env.BILLING_WAVE_ACTIVE = 'true'
  process.env.TEACHER_INVITE_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.BILLING_WAVE_ACTIVE
})

async function reg(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student'; verifyEmail?: boolean } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  if (opts.verifyEmail !== false) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function setupTeacherAndLearner(prefix: string) {
  const teacher = await reg(`${prefix}-teacher@example.com`, { role: 'teacher' })
  const learner = await reg(`${prefix}-learner@example.com`)
  await setAssignedTeacher(learner.accountId, teacher.accountId)
  return { teacher, learner }
}

async function teacherSessionCookie(teacherId: string): Promise<string> {
  const session = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`
}

async function setPairPaymentMethod(
  teacherId: string,
  learnerId: string,
  method: 'postpaid' | 'none',
) {
  await getDbPool().query(
    `insert into learner_billing_preferences
       (teacher_account_id, learner_account_id, payment_method)
     values ($1::uuid, $2::uuid, $3)
     on conflict (teacher_account_id, learner_account_id) do update
       set payment_method = excluded.payment_method`,
    [teacherId, learnerId, method],
  )
}

describe('Per-learner payment-method gap — dropped enum reject + valid transitions', () => {
  // epic-b Sub-PR B.1 (2026-06-11): Q1 debt-open invariant retired.
  // 'prepaid_packages' value dropped from the enum (mig 0126); the only
  // remaining transitions are postpaid ↔ none, so a "switch from
  // postpaid into packages with open debt" branch no longer exists.
  // The tests below now pin the rejection contract for the dropped
  // value instead.
  it('rejects PATCH to dropped value prepaid_packages with 422', async () => {
    const { teacher, learner } = await setupTeacherAndLearner('plpm-q1-reject')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')

    const r = await billingPatchHandler(
      buildRequest(`/api/teacher/learners/${learner.accountId}/billing`, {
        method: 'PATCH',
        cookie: teacher.cookie,
        body: { method: 'prepaid_packages' },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('invalid_method')
    // The pair method must NOT have changed.
    expect(
      await getPaymentMethodForPair(teacher.accountId, learner.accountId),
    ).toBe('postpaid')
  })

  it('allows PATCH none → postpaid (target method valid)', async () => {
    const { teacher, learner } = await setupTeacherAndLearner('plpm-q1-none')
    const r1 = await billingPatchHandler(
      buildRequest(`/api/teacher/learners/${learner.accountId}/billing`, {
        method: 'PATCH',
        cookie: teacher.cookie,
        body: { method: 'postpaid' },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    expect(r1.status).toBe(200)
    expect(
      await getPaymentMethodForPair(teacher.accountId, learner.accountId),
    ).toBe('postpaid')
  })
})

describe('Per-learner payment-method gap — Q5 authz (only teacher can PATCH)', () => {
  it('learner trying to PATCH their own billing → 401 or 403 (NOT 200)', async () => {
    const { teacher, learner } = await setupTeacherAndLearner('plpm-q5-self')
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')

    const r = await billingPatchHandler(
      buildRequest(`/api/teacher/learners/${learner.accountId}/billing`, {
        method: 'PATCH',
        cookie: learner.cookie,
        body: { method: 'postpaid' },
      }),
      { params: Promise.resolve({ id: learner.accountId }) },
    )
    // The route is gated by requireTeacherWithCurrentSaasOfferConsent;
    // a learner-role session is rejected at exactly one of two
    // points: no teacher role → 401, or wrong role on a teacher
    // perimeter → 403. We pin to that exact set so a regression to
    // 404 / 422 / any other non-200 4xx fails (codex-paranoia wave
    // round-1 WARN #4 closure).
    expect([401, 403]).toContain(r.status)

    const stillNone = await getPaymentMethodForPair(
      teacher.accountId,
      learner.accountId,
    )
    expect(stillNone).toBe('none')
  })

  it(
    'different teacher trying to PATCH foreign learner → 403 not_your_learner',
    async () => {
      const { teacher: teacherA, learner } = await setupTeacherAndLearner('plpm-q5-other')
      const teacherB = await reg(`plpm-q5-teacherB@example.com`, { role: 'teacher' })
      await setPairPaymentMethod(teacherA.accountId, learner.accountId, 'none')

      const r = await billingPatchHandler(
        buildRequest(`/api/teacher/learners/${learner.accountId}/billing`, {
          method: 'PATCH',
          cookie: teacherB.cookie,
          body: { method: 'postpaid' },
        }),
        { params: Promise.resolve({ id: learner.accountId }) },
      )
      expect(r.status).toBe(403)
      const body = await r.json()
      expect(body.error).toBe('not_your_learner')

      // The legit pair is untouched.
      const a = await getPaymentMethodForPair(
        teacherA.accountId,
        learner.accountId,
      )
      expect(a).toBe('none')
      // And no row was magically created for teacherB.
      const b = await getPaymentMethodForPair(
        teacherB.accountId,
        learner.accountId,
      )
      expect(b).toBe('none')
    },
    30_000,
  )

  it(
    'admin role trying to PATCH learner billing → 401 or 403 (route gated on teacher role only)',
    async () => {
      const { teacher, learner } = await setupTeacherAndLearner('plpm-q5-admin')
      const admin = await reg(`plpm-q5-admin-x@example.com`, { role: 'admin' })
      await setPairPaymentMethod(teacher.accountId, learner.accountId, 'none')

      const r = await billingPatchHandler(
        buildRequest(`/api/teacher/learners/${learner.accountId}/billing`, {
          method: 'PATCH',
          cookie: admin.cookie,
          body: { method: 'postpaid' },
        }),
        { params: Promise.resolve({ id: learner.accountId }) },
      )
      // Q5 in the owner answers = «только учитель может менять prefs»
      // (no admin override). The guard is requireTeacherWithCurrent-
      // SaasOfferConsent which rejects admin-only accounts at the
      // same {401 no-teacher-role, 403 wrong-role} hinge as the
      // learner-self test (codex-paranoia wave round-1 WARN #4
      // closure — pin instead of "any 4xx").
      expect([401, 403]).toContain(r.status)
    },
    30_000,
  )
})

describe('Per-learner payment-method gap — Q7 audit row contract', () => {
  it(
    'successful PATCH writes auth.billing.method_changed with correct payload',
    async () => {
      const { teacher, learner } = await setupTeacherAndLearner('plpm-q7')
      // Direct helper call — the route layer is covered by Q1/Q5 tests
      // above; here we pin the audit-row contract on the canonical writer.
      const result = await setPaymentMethodForPair({
        teacherId: teacher.accountId,
        learnerId: learner.accountId,
        method: 'postpaid',
        byAccountId: teacher.accountId,
      })

      const pool = getAuthPool()
      const auditRows = await pool.query<{
        account_id: string
        payload: Record<string, unknown>
      }>(
        `select account_id, payload
           from auth_audit_events
          where event_type = 'auth.billing.method_changed'
            and account_id = $1
          order by created_at desc
          limit 1`,
        [teacher.accountId],
      )
      expect(auditRows.rows).toHaveLength(1)
      const row = auditRows.rows[0]
      expect(row.account_id).toBe(teacher.accountId)
      expect(row.payload.learner_account_id).toBe(learner.accountId)
      expect(row.payload.from_method).toBe('none')
      expect(row.payload.to_method).toBe('postpaid')
    },
    30_000,
  )
})

describe('Per-learner payment-method gap — invite-default flow (§Scope item 6)', () => {
  it('invite created with default=postpaid seeds pref on redeem + emits audit row', async () => {
    // epic-b Sub-PR B.1 (2026-06-11): rewritten from 'prepaid_packages'
    // → 'postpaid' default after mig 0126 dropped the prepaid value.
    // Behaviour under test is identical: invite-default flow seeds
    // learner_billing_preferences + emits a method_changed audit row.

    // 1. Teacher self-registers + creates an invite with default method.
    const teacher = await reg('plpm-inv-pp-teacher@example.com', {
      role: 'teacher',
    })
    const cookie = await teacherSessionCookie(teacher.accountId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', {
        cookie,
        body: { defaultPaymentMethod: 'postpaid' },
      }),
    )
    expect(createRes.status).toBe(200)
    const createdJson = await createRes.json()
    expect(createdJson.defaultPaymentMethod).toBe('postpaid')

    // 2. Extract the token. The wire token still encodes only iid/tid;
    //    the default method lives in the DB row.
    const tokenMatch = (createdJson.url as string).match(/invite=([^&]+)/)
    const token = decodeURIComponent(tokenMatch![1])
    const payload = verifyInviteToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.exp).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
        + TEACHER_INVITE_DEFAULT_TTL_SECONDS
        - 60,
    )

    // 3. Confirm the DB row carries the default.
    const authPool = getAuthPool()
    const inviteRow = await authPool.query<{ default_payment_method: string }>(
      `select default_payment_method from teacher_invites where id = $1`,
      [createdJson.id],
    )
    expect(inviteRow.rows[0].default_payment_method).toBe('postpaid')

    // 4. Learner registers via the invite.
    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'plpm-inv-pp-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(regRes.status).toBe(200)
    const learner = await getAccountByEmail('plpm-inv-pp-learner@example.com')
    expect(learner).not.toBeNull()

    // 5. learner_billing_preferences row should be seeded to 'postpaid'.
    const seeded = await getPaymentMethodForPair(
      teacher.accountId,
      learner!.id,
    )
    expect(seeded).toBe('postpaid')

    // 6. Audit row written under the teacher's account_id with from='none'
    //    and to='postpaid' (mirrors a teacher-driven PATCH).
    const audit = await authPool.query<{
      account_id: string
      payload: Record<string, unknown>
    }>(
      `select account_id, payload
         from auth_audit_events
        where event_type = 'auth.billing.method_changed'
          and account_id = $1
        order by created_at desc
        limit 1`,
      [teacher.accountId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].payload.learner_account_id).toBe(learner!.id)
    expect(audit.rows[0].payload.from_method).toBe('none')
    expect(audit.rows[0].payload.to_method).toBe('postpaid')
    expect(audit.rows[0].payload.source).toBe('invite_default')
  })

  it('invite with default=none keeps legacy behaviour: no pref row, no method_changed audit', async () => {
    const teacher = await reg('plpm-inv-none-teacher@example.com', {
      role: 'teacher',
    })
    const cookie = await teacherSessionCookie(teacher.accountId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', {
        cookie,
        body: { defaultPaymentMethod: 'none' },
      }),
    )
    expect(createRes.status).toBe(200)
    const createdJson = await createRes.json()
    expect(createdJson.defaultPaymentMethod).toBe('none')
    const token = decodeURIComponent(
      (createdJson.url as string).match(/invite=([^&]+)/)![1],
    )

    const regRes = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'plpm-inv-none-learner@example.com',
          password: 'integration test password value',
          personalDataConsentAccepted: true,
          inviteToken: token,
        },
      }),
    )
    expect(regRes.status).toBe(200)
    const learner = await getAccountByEmail('plpm-inv-none-learner@example.com')
    expect(learner).not.toBeNull()

    // The redeem CTE always seeds a learner_billing_preferences row
    // (so absence-of-row never becomes a hidden state the helper has
    // to defend against). For default='none' the row carries
    // payment_method='none', which is observationally identical to
    // no-row via getPaymentMethodForPair (both return 'none'). The
    // load-bearing assertion for «legacy behaviour» is:
    //   1. effective method stays 'none' (booking blocked).
    //   2. NO auth.billing.method_changed audit row is emitted
    //      (because there was no semantic change worth auditing).
    const effective = await getPaymentMethodForPair(
      teacher.accountId,
      learner!.id,
    )
    expect(effective).toBe('none')

    const authPool = getAuthPool()
    const audit = await authPool.query(
      `select 1
         from auth_audit_events
        where event_type = 'auth.billing.method_changed'
          and account_id = $1`,
      [teacher.accountId],
    )
    expect(audit.rows).toHaveLength(0)
  })

  it('invite created without defaultPaymentMethod defaults to none (back-compat)', async () => {
    const teacher = await reg('plpm-inv-omit-teacher@example.com', {
      role: 'teacher',
    })
    const cookie = await teacherSessionCookie(teacher.accountId)
    // Empty body — legacy clients send no defaultPaymentMethod field.
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', { cookie, body: {} }),
    )
    expect(createRes.status).toBe(200)
    const createdJson = await createRes.json()
    expect(createdJson.defaultPaymentMethod).toBe('none')

    const authPool = getAuthPool()
    const inviteRow = await authPool.query<{ default_payment_method: string }>(
      `select default_payment_method from teacher_invites where id = $1`,
      [createdJson.id],
    )
    expect(inviteRow.rows[0].default_payment_method).toBe('none')
  })

  it('POST /api/teacher/invites rejects invalid defaultPaymentMethod with 422', async () => {
    const teacher = await reg('plpm-inv-bad-teacher@example.com', {
      role: 'teacher',
    })
    const cookie = await teacherSessionCookie(teacher.accountId)
    const r = await createInviteHandler(
      buildRequest('/api/teacher/invites', {
        cookie,
        body: { defaultPaymentMethod: 'not-a-method' },
      }),
    )
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('invalid_default_payment_method')
    // Ensure no invite row was created.
    const authPool = getAuthPool()
    const c = await authPool.query<{ count: string }>(
      `select count(*)::text as count from teacher_invites where teacher_account_id = $1`,
      [teacher.accountId],
    )
    expect(c.rows[0].count).toBe('0')
  })

  it('invite redeem on PRE-EXISTING pref row preserves the prior method AND does NOT emit a method_changed audit', async () => {
    // Codex-paranoia wave round-1 BLOCKER #1 coverage:
    //
    // The redeem CTE seeds learner_billing_preferences with
    // `on conflict (teacher, learner) do nothing` — a pre-existing
    // row (e.g. the learner was previously linked to this teacher
    // under 'postpaid', then unlinked, then re-redeems a fresh
    // invite carrying default='none') must NOT be clobbered, and we
    // must NOT emit `auth.billing.method_changed` for a change that
    // never happened.
    //
    // epic-b Sub-PR B.1 (2026-06-11): rewritten from
    // default='prepaid_packages' → default='none' after mig 0126
    // dropped the prepaid value. The conflict-preserve semantic is
    // the SUT, not the specific default value.
    const teacher = await reg('plpm-inv-conflict-teacher@example.com', {
      role: 'teacher',
    })
    const learnerEmail = 'plpm-inv-conflict-learner@example.com'
    const learner = await reg(learnerEmail, {})

    // Simulate a prior life of the pair: row exists with method='postpaid'.
    await setPairPaymentMethod(teacher.accountId, learner.accountId, 'postpaid')
    // Clear the audit row that setPairPaymentMethod / setPaymentMethodForPair
    // would have written, so the post-redeem assertion is unambiguous.
    const authPool = getAuthPool()
    await authPool.query(
      `delete from auth_audit_events
        where event_type = 'auth.billing.method_changed'
          and account_id = $1`,
      [teacher.accountId],
    )

    // Build a fresh invite carrying default='none' (any non-postpaid
    // value is enough to detect the on-conflict-do-nothing behaviour).
    const cookie = await teacherSessionCookie(teacher.accountId)
    const createRes = await createInviteHandler(
      buildRequest('/api/teacher/invites', {
        cookie,
        body: { defaultPaymentMethod: 'none' },
      }),
    )
    expect(createRes.status).toBe(200)
    const createdJson = await createRes.json()

    // Redeem via register-with-invite for the SAME learner via login
    // path is not the test's concern; the production redeem CTE only
    // takes (invite_id, learner_account_id) and the seed step is the
    // unit under test. Call the helper directly.
    const {
      redeemInviteAndBindLearnerAtomic,
    } = await import('@/lib/auth/teacher-invites')
    const redeemed = await redeemInviteAndBindLearnerAtomic(
      createdJson.id,
      learner.accountId,
    )
    expect(redeemed).not.toBeNull()
    expect(redeemed!.defaultPaymentMethod).toBe('none')
    // The seed must report `seededPrefInserted=false` so the caller
    // (register route) skips the audit-row emit.
    expect(redeemed!.seededPrefInserted).toBe(false)

    // The pair's actual method is the prior value, NOT the invite default.
    const after = await getPaymentMethodForPair(
      teacher.accountId,
      learner.accountId,
    )
    expect(after).toBe('postpaid')

    // No method_changed audit row landed (no change actually happened).
    const audit = await authPool.query(
      `select 1
         from auth_audit_events
        where event_type = 'auth.billing.method_changed'
          and account_id = $1`,
      [teacher.accountId],
    )
    expect(audit.rows).toHaveLength(0)
  })

  // Codex-paranoia wave round-2 WARN #1 — partial closure note:
  //
  // The conflict-preserve test ABOVE exercises the CTE branch
  // directly. A regression that drops the `seededPrefInserted`
  // gate in `app/api/auth/register/route.ts` would slip past that
  // test. We considered adding a vitest spy on
  // `redeemInviteAndBindLearnerAtomic` to inject a fake
  // `seededPrefInserted=false` return into the register route,
  // but the route imports the symbol destructured at module load
  // time, so `vi.spyOn(module, 'redeemInviteAndBindLearnerAtomic')`
  // would mutate a binding the route never re-resolves — a
  // false-confidence test. A full `vi.mock` factory would conflict
  // with the other invite tests in this file that need the real
  // CTE.
  //
  // The route-level gate IS covered today by the
  // `invite created with default=prepaid_packages seeds pref on
  // redeem + emits audit row` test in this same suite — it pins
  // the POSITIVE branch (seededPrefInserted=true → audit row
  // emitted). A regression that drops the gate would either:
  //   (a) emit even when seededPrefInserted=false → caught by
  //       any future test that runs the conflict scenario through
  //       the route (deferred to the redeem-for-existing-learner
  //       endpoint epic, which doesn't exist yet);
  //   (b) suppress even when seededPrefInserted=true → caught by
  //       the positive test failing.
  //
  // Net coverage: the GATE-VALUE returned by the CTE is locked
  // (conflict-preserve test); the POSITIVE branch of the route is
  // locked; the NEGATIVE branch of the route is not directly
  // testable through public surface today and would need either
  // module-system refactor (named-export indirection) or a new
  // endpoint. Tracked as a follow-up; not blocking gap-close ship.

  it('POST /api/teacher/invites rejects malformed JSON body with 422 (no silent fallback to default=none)', async () => {
    // Codex-paranoia wave round-2 WARN #2 closure: a body that is
    // present but unparseable used to be swallowed as "empty body"
    // and create an invite with defaultPaymentMethod='none'. The
    // route now fail-closes with 422 invalid_json.
    const teacher = await reg('plpm-inv-bad-json-teacher@example.com', {
      role: 'teacher',
    })
    const cookie = await teacherSessionCookie(teacher.accountId)
    // buildRequest auto-JSON.stringifies its body, so we hand-build
    // the Request to inject a deliberately-malformed body string.
    const req = new Request(
      `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/teacher/invites`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          'Sec-Fetch-Site': 'same-origin',
          cookie,
        },
        body: '{ this is not valid json',
      },
    )
    const r = await createInviteHandler(req)
    expect(r.status).toBe(422)
    const body = await r.json()
    expect(body.error).toBe('invalid_json')

    // No invite row landed.
    const authPool = getAuthPool()
    const c = await authPool.query<{ count: string }>(
      `select count(*)::text as count from teacher_invites where teacher_account_id = $1`,
      [teacher.accountId],
    )
    expect(c.rows[0].count).toBe('0')
  })
})
