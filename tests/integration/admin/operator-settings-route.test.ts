import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DELETE as deleteHandler,
  POST as postHandler,
} from '@/app/api/admin/settings/alerts/setting/[key]/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
} from '../helpers'

// ALERTS-EDITOR Sub-PR C (2026-05-18) — integration tests for
// POST + DELETE /api/admin/settings/alerts/setting/[key].
// Plan: docs/plans/alerts-editor.md §4.4.
//
// Covers: anon/non-admin/admin shapes; happy POST/DELETE; 400
// invalid_body / unknown_key / invalid_value; 409 concurrent_update
// (first-create race + stale expectedUpdatedAt).
//
// Migration-pending (503) is NOT tested here — Sub-PR A's
// operator-settings.test.ts pins that the lib layer returns
// migration_pending; the route's status-map is mechanical.

async function registerAndCookie(opts: {
  email: string
  verified?: boolean
  role?: 'admin' | 'teacher'
}): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: {
        email: opts.email,
        password,
        personalDataConsentAccepted: true,
      },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(opts.email)
  expect(created).not.toBeNull()
  if (opts.verified) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', {
      body: { email: opts.email, password },
    }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

function postReq(key: string, body: unknown, cookie?: string): Request {
  return buildRequest(`/api/admin/settings/alerts/setting/${key}`, {
    cookie,
    body,
  })
}

function deleteReq(key: string, body: unknown, cookie?: string): Request {
  return buildRequest(`/api/admin/settings/alerts/setting/${key}`, {
    cookie,
    body,
    method: 'DELETE',
  })
}

async function clearOpSettings(): Promise<void> {
  const pool = getDbPool()
  await pool.query(`delete from operator_settings`)
  // events table: 89-day immutability trigger blocks DELETE on
  // recent rows; TRUNCATE bypasses row-level triggers (used for
  // test cleanup only).
  await pool.query(`truncate operator_settings_events restart identity`)
}

beforeEach(async () => {
  await clearOpSettings()
})
afterEach(async () => {
  await clearOpSettings()
})

describe('POST /api/admin/settings/alerts/setting/[key] (anon/non-admin)', () => {
  it('anon → 401/403 (admin gate)', async () => {
    const res = await postHandler(
      postReq('CALENDAR_PATHOLOGY_THRESHOLD', {
        value: '5',
        expectedUpdatedAt: null,
      }),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect([401, 403]).toContain(res.status)
  })

  it('non-admin learner → 403', async () => {
    const learner = await registerAndCookie({
      email: 'os-route-learner@example.com',
      verified: true,
    })
    const res = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '5', expectedUpdatedAt: null },
        learner.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /api/admin/settings/alerts/setting/[key] (admin happy path)', () => {
  it('first create returns 200 + updatedAt', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-admin-create@example.com',
      verified: true,
      role: 'admin',
    })
    const res = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '5', expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; updatedAt: string }
    expect(body.ok).toBe(true)
    expect(body.updatedAt).toBeTruthy()
  })

  it('400 on unknown_key', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-unknown@example.com',
      verified: true,
      role: 'admin',
    })
    const res = await postHandler(
      postReq('NOT_A_REAL_KEY', { value: '5', expectedUpdatedAt: null }, admin.cookie),
      { params: Promise.resolve({ key: 'NOT_A_REAL_KEY' }) },
    )
    expect(res.status).toBe(400)
  })

  it('400 on invalid_value (out of range)', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-oor@example.com',
      verified: true,
      role: 'admin',
    })
    const res = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '999', expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_value')
  })

  it('400 on missing value field', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-missing-val@example.com',
      verified: true,
      role: 'admin',
    })
    const res = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(400)
  })

  it('409 first-create race (expectedUpdatedAt non-null on missing row)', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-fcrace@example.com',
      verified: true,
      role: 'admin',
    })
    const res = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        {
          value: '5',
          expectedUpdatedAt: new Date().toISOString(),
        },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(409)
  })

  it('409 stale expectedUpdatedAt on update', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-stale@example.com',
      verified: true,
      role: 'admin',
    })
    const first = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '5', expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(first.status).toBe(200)
    const stale = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '7', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(stale.status).toBe(409)
  })
})

// BCS-DEF-1-TEST-FILLOUT item 7 (2026-05-19) — per-key POST + DELETE
// coverage for the 4 new CONFLICT_UNRESOLVED_* keys added by the
// BCS-DEF-1 epic. Mirrors the CALENDAR_PATHOLOGY_THRESHOLD harness
// above. SETTING_SCHEMA contract:
//   CONFLICT_UNRESOLVED_THRESHOLD_MINUTES    min=5,      max=1440
//   CONFLICT_UNRESOLVED_REPORT_LIMIT         min=1,      max=500
//   CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT    min=1,      max=50
//   CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS      min=60_000, max=604_800_000
type ConflictKeySpec = {
  key:
    | 'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES'
    | 'CONFLICT_UNRESOLVED_REPORT_LIMIT'
    | 'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT'
    | 'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS'
  valid: string
  outOfRange: string
}

const CONFLICT_KEYS: ReadonlyArray<ConflictKeySpec> = [
  {
    key: 'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
    valid: '180',
    outOfRange: '1441',
  },
  {
    key: 'CONFLICT_UNRESOLVED_REPORT_LIMIT',
    valid: '25',
    outOfRange: '501',
  },
  {
    key: 'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
    valid: '10',
    outOfRange: '51',
  },
  {
    key: 'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
    valid: '7200000',
    outOfRange: '59999',
  },
]

describe.each(CONFLICT_KEYS)(
  'CONFLICT_UNRESOLVED_* per-key route ($key)',
  ({ key, valid, outOfRange }) => {
    it(`POST <valid value> → 200 + row in operator_settings`, async () => {
      const admin = await registerAndCookie({
        email: `os-route-cu-${key.toLowerCase()}-set@example.com`,
        verified: true,
        role: 'admin',
      })
      const res = await postHandler(
        postReq(key, { value: valid, expectedUpdatedAt: null }, admin.cookie),
        { params: Promise.resolve({ key }) },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; updatedAt: string }
      expect(body.ok).toBe(true)
      expect(body.updatedAt).toBeTruthy()

      const pool = getDbPool()
      const r = await pool.query(
        `select value from operator_settings where key = $1`,
        [key],
      )
      expect(r.rows.length).toBe(1)
      expect(String(r.rows[0].value)).toBe(valid)
    })

    it(`DELETE after POST → 200 + row removed`, async () => {
      const admin = await registerAndCookie({
        email: `os-route-cu-${key.toLowerCase()}-del@example.com`,
        verified: true,
        role: 'admin',
      })
      const first = await postHandler(
        postReq(key, { value: valid, expectedUpdatedAt: null }, admin.cookie),
        { params: Promise.resolve({ key }) },
      )
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as { updatedAt: string }

      const res = await deleteHandler(
        deleteReq(
          key,
          { expectedUpdatedAt: firstBody.updatedAt },
          admin.cookie,
        ),
        { params: Promise.resolve({ key }) },
      )
      expect(res.status).toBe(200)

      const pool = getDbPool()
      const r = await pool.query(
        `select count(*)::int as n from operator_settings where key = $1`,
        [key],
      )
      expect(r.rows[0].n).toBe(0)
    })

    it(`POST <out-of-range value> → 400 invalid_value`, async () => {
      const admin = await registerAndCookie({
        email: `os-route-cu-${key.toLowerCase()}-oor@example.com`,
        verified: true,
        role: 'admin',
      })
      const res = await postHandler(
        postReq(
          key,
          { value: outOfRange, expectedUpdatedAt: null },
          admin.cookie,
        ),
        { params: Promise.resolve({ key }) },
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('invalid_value')

      // No row should be persisted on rejection.
      const pool = getDbPool()
      const r = await pool.query(
        `select count(*)::int as n from operator_settings where key = $1`,
        [key],
      )
      expect(r.rows[0].n).toBe(0)
    })
  },
)

describe('DELETE /api/admin/settings/alerts/setting/[key]', () => {
  it('admin happy delete returns 200', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-del-happy@example.com',
      verified: true,
      role: 'admin',
    })
    const first = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '5', expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    const firstBody = (await first.json()) as { updatedAt: string }
    const res = await deleteHandler(
      deleteReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { expectedUpdatedAt: firstBody.updatedAt },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(200)
    const pool = getDbPool()
    const r = await pool.query(
      `select count(*)::int as n from operator_settings where key = $1`,
      ['CALENDAR_PATHOLOGY_THRESHOLD'],
    )
    expect(r.rows[0].n).toBe(0)
  })

  it('non-admin → 403', async () => {
    const learner = await registerAndCookie({
      email: 'os-route-del-learner@example.com',
      verified: true,
    })
    const res = await deleteHandler(
      deleteReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { expectedUpdatedAt: new Date().toISOString() },
        learner.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(403)
  })

  it('409 on stale expectedUpdatedAt', async () => {
    const admin = await registerAndCookie({
      email: 'os-route-del-stale@example.com',
      verified: true,
      role: 'admin',
    })
    const first = await postHandler(
      postReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { value: '5', expectedUpdatedAt: null },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(first.status).toBe(200)
    const res = await deleteHandler(
      deleteReq(
        'CALENDAR_PATHOLOGY_THRESHOLD',
        { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
        admin.cookie,
      ),
      { params: Promise.resolve({ key: 'CALENDAR_PATHOLOGY_THRESHOLD' }) },
    )
    expect(res.status).toBe(409)
  })
})
