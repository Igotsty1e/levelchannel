import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { promisify } from 'node:util'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-4 (2026-05-19) — integration coverage of
// scripts/learner-reminder-dispatch.mjs (Sub-PR B). Mirrors the
// execFile + RESEND_BASE_URL stub-server pattern from
// tests/integration/scripts/conflict-unresolved-alert.test.ts so the
// real Resend SDK code path runs end-to-end without leaving localhost.
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §3.4.

const execFileP = promisify(execFile)

type StubBehaviour = 'success' | 'fail_500'

let stubServer: Server | null = null
let stubPort = 0
let stubBehaviour: StubBehaviour = 'success'
let stubSendCount = 0

function setStubBehaviour(next: StubBehaviour): void {
  stubBehaviour = next
}

beforeAll(async () => {
  stubServer = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      stubSendCount += 1
      if (stubBehaviour === 'success') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: `stub-${stubSendCount}` }))
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            statusCode: 500,
            message: 'stub resend forced failure',
            name: 'internal_server_error',
          }),
        )
      }
    })
  })
  await new Promise<void>((resolve) => {
    stubServer!.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = stubServer!.address()
  if (!addr || typeof addr === 'string') {
    throw new Error('stub server did not bind to a numeric port')
  }
  stubPort = addr.port
})

afterAll(async () => {
  if (stubServer) {
    await new Promise<void>((resolve) => stubServer!.close(() => resolve()))
    stubServer = null
  }
})

beforeEach(async () => {
  setStubBehaviour('success')
  stubSendCount = 0
  const pool = getDbPool()
  // Each test starts with clean dispatch + probe_runs tables. setup.ts
  // truncates lesson_slots + accounts so we don't need to touch those.
  await pool.query(`delete from learner_reminder_dispatches`)
  await pool.query(`delete from probe_runs`)
  await pool.query(
    `delete from operator_settings where key like 'LEARNER_REMIND%'`,
  )
})

afterEach(async () => {
  const pool = getDbPool()
  await pool.query(`delete from learner_reminder_dispatches`)
  await pool.query(`delete from probe_runs`)
  await pool.query(
    `delete from operator_settings where key like 'LEARNER_REMIND%'`,
  )
})

function probeUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set in the test harness')
  return url
}

function probeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: probeUrl(),
    RESEND_BASE_URL: `http://127.0.0.1:${stubPort}`,
    ...extra,
  } as NodeJS.ProcessEnv
}

async function runScheduler(
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  const r = await execFileP(
    process.execPath,
    ['scripts/learner-reminder-dispatch.mjs'],
    { env: probeEnv(env), cwd: process.cwd() },
  )
  return { stdout: r.stdout, stderr: r.stderr }
}

async function makeTeacher(emailPrefix: string): Promise<string> {
  const id = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  }).then((a) => a.id)
  await grantAccountRole(id, 'teacher', null)
  return id
}

async function makeLearner(emailPrefix: string): Promise<string> {
  const id = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  }).then((a) => a.id)
  return id
}

/**
 * Insert a `booked` future slot where `start_at` is the next eligible
 * 30-min-aligned MSK timestamp >= now() + targetMinutes. The actual
 * delta is reported via the returned `actualMinutes` so the caller
 * can size the operator window precisely (target +5min headroom).
 *
 * The migration 0031 invariants enforce:
 *   1. Start within 06:00–22:00 MSK band.
 *   2. Start aligned to a 30-min boundary in MSK (00 or 30).
 *
 * The fixture also forces the picked cell to be inside the MSK
 * business band; if a candidate falls past 22:00 we walk forward to
 * the next eligible 06:00.
 */
async function seedBookedSlot(opts: {
  teacherId: string
  learnerId: string
  /** Floor on minutes-from-now; snapped UP to the next eligible cell. */
  startInMinutes: number
  zoomUrl?: string | null
}): Promise<{ slotId: string; actualMinutes: number }> {
  const pool = getDbPool()
  const startUtc = pickAlignedFutureMskUtc(opts.startInMinutes)
  const actualMinutes = Math.round((startUtc.getTime() - Date.now()) / 60_000)
  const ins = await pool.query(
    `insert into lesson_slots (
       id, teacher_account_id, start_at, duration_minutes, status, zoom_url
     ) values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open', $3::text)
     returning id`,
    [opts.teacherId, startUtc.toISOString(), opts.zoomUrl ?? null],
  )
  const slotId = String(ins.rows[0].id)
  await pool.query(
    `update lesson_slots
        set status = 'booked',
            learner_account_id = $1::uuid,
            booked_at = now()
      where id = $2::uuid`,
    [opts.learnerId, slotId],
  )
  return { slotId, actualMinutes }
}

// Pick the next 30-min-aligned UTC instant that lands inside the
// MSK business band and is ≥ now() + targetMinutes. MSK = UTC+3, no
// DST. The "approximate" offset means a 60-min request might come
// back as 60..119 minutes depending on the current minute-of-MSK-hour
// and the business band.
function pickAlignedFutureMskUtc(targetMinutes: number): Date {
  const MSK_OFFSET_MIN = 3 * 60
  const now = Date.now()
  let candidate = new Date(now + targetMinutes * 60_000)
  // Snap UP to next 30-min mark in MSK.
  const candidateMskMs = candidate.getTime() + MSK_OFFSET_MIN * 60_000
  const remainderMs = candidateMskMs % (30 * 60_000)
  if (remainderMs !== 0) {
    candidate = new Date(candidate.getTime() + (30 * 60_000 - remainderMs))
  }
  // Now walk forward 30 min at a time until we land inside business band.
  for (let i = 0; i < 96; i += 1) {
    const mskParts = mskWallParts(candidate.getTime())
    const inBand =
      mskParts.hour >= 6
      && (mskParts.hour < 22 || (mskParts.hour === 22 && mskParts.minute === 0))
    if (inBand) return candidate
    candidate = new Date(candidate.getTime() + 30 * 60_000)
  }
  throw new Error('could not find an in-band 30-min-aligned cell within 48h')
}

function mskWallParts(utcMs: number): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  return {
    hour: map.hour === 24 ? 0 : map.hour ?? 0,
    minute: map.minute ?? 0,
  }
}

async function readDispatches(): Promise<
  Array<{
    slotId: string
    channel: string
    status: string
    skippedReason: string | null
    windowMinutes: number
    resendEmailId: string | null
    lastError: string | null
  }>
> {
  const r = await getDbPool().query(
    `select slot_id, channel, status, skipped_reason,
            window_minutes_at_dispatch, resend_email_id, last_error
       from learner_reminder_dispatches
       order by created_at asc`,
  )
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    channel: String(row.channel),
    status: String(row.status),
    skippedReason: row.skipped_reason ? String(row.skipped_reason) : null,
    windowMinutes: Number(row.window_minutes_at_dispatch),
    resendEmailId: row.resend_email_id ? String(row.resend_email_id) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  }))
}

async function readLatestProbeRun(): Promise<{
  verdictKind: string
  stats: Record<string, unknown> | null
}> {
  const r = await getDbPool().query(
    `select verdict_kind, stats from probe_runs
      where probe_name = 'learner-reminders' and is_test = false
      order by ran_at desc limit 1`,
  )
  if (!r.rows[0]) {
    throw new Error('expected at least one learner-reminders probe_run row')
  }
  return {
    verdictKind: String(r.rows[0].verdict_kind),
    stats: (r.rows[0].stats as Record<string, unknown> | null) ?? null,
  }
}

async function setOperatorKey(key: string, value: string): Promise<void> {
  await getDbPool().query(
    `insert into operator_settings (key, value, description)
     values ($1, $2, 'integration-test seed')
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  )
}

/**
 * Pick an operator window that covers a seeded slot. The scheduler
 * accepts a slot when `start_at - now() ∈ (window*60 - 30s,
 * window*60 + 30s]`. Setting `window = actualMinutes` works for
 * `start_at ≈ now() + actualMinutes` because the schedule runs
 * sub-second after seed (slot drift is well inside the ±30s band).
 *
 * Min 5 (matches LEARNER_REMINDER_WINDOW_MINUTES.min in the schema);
 * Max 360 (matches LEARNER_REMINDER_WINDOW_MINUTES.max). When CI runs
 * in late MSK hours and band-walk pushes the slot to next-day morning,
 * actualMinutes can exceed 360 — the cron clamps the window and the
 * slot becomes invisible. The clamp here is a defensive minimum; the
 * test SHOULD use `slotIsWithinWindow()` below to skip cleanly when
 * the band-walk overshoots.
 */
function windowMinutesForSlot(actualMinutes: number): string {
  return String(Math.min(360, Math.max(5, actualMinutes)))
}

// Returns true iff the picked slot is within the LEARNER_REMINDER_WINDOW_MINUTES
// max (360). Tests that pre-set window per actualMinutes should skip when this
// is false — band-walk pushed the slot too far for the cron to see it.
function slotIsWithinWindow(actualMinutes: number): boolean {
  return actualMinutes <= 360
}

// Helper: log + return-true if a test should skip because band-walk
// overshoot pushed the slot past the 360-min WINDOW_MINUTES max. Used
// by the 5 tests that pre-set the window per actualMinutes and assume
// the cron will see the slot.
function skipIfBandWalkOvershoot(
  testName: string,
  seeded: { actualMinutes: number },
): boolean {
  if (!slotIsWithinWindow(seeded.actualMinutes)) {
    console.warn(
      `[lrd-test] skipping ${testName}: slot at +${seeded.actualMinutes}min > 360 max window`,
    )
    return true
  }
  return false
}

// ----------------------------------------------------------------------
// Happy path
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — happy path', () => {
  it('slot at ~T+60min → 1 sent dispatch row, 1 stub-Resend call, verdict=ok', async () => {
    const teacher = await makeTeacher('lrd-h-t')
    const learner = await makeLearner('lrd-h-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
      zoomUrl: 'https://meet.example.com/lesson-1',
    })
    if (skipIfBandWalkOvershoot('happy-path', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )

    await runScheduler({
      RESEND_API_KEY: 're_stub_key',
      EMAIL_FROM: 'LevelChannel <noreply@example.com>',
    })

    const rows = await readDispatches()
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe('email')
    expect(rows[0].status).toBe('sent')
    expect(rows[0].skippedReason).toBeNull()
    expect(rows[0].resendEmailId).toBe('stub-1')
    expect(stubSendCount).toBe(1)

    const run = await readLatestProbeRun()
    expect(run.verdictKind).toBe('ok')
    expect(run.stats).not.toBeNull()
    expect(run.stats!.sent_email).toBe(1)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Idempotency: double tick never sends twice
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — idempotency', () => {
  it('second tick on the same due slot → no second send (ON CONFLICT DO NOTHING)', async () => {
    const teacher = await makeTeacher('lrd-id-t')
    const learner = await makeLearner('lrd-id-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
    })
    if (skipIfBandWalkOvershoot('test', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })
    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sent')
    expect(stubSendCount).toBe(1)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Window boundaries
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — window boundaries', () => {
  it('slot far outside the +30s upper bound → no row, no send', async () => {
    const teacher = await makeTeacher('lrd-w-t')
    const learner = await makeLearner('lrd-w-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 240, // 4h ahead
    })
    // Default 60-min window: slot at 240+min is outside.
    expect(seeded.actualMinutes).toBeGreaterThanOrEqual(60 * 2)

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(0)
    expect(stubSendCount).toBe(0)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Master switch off — both channels disabled
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — master switch off', () => {
  it('LEARNER_REMINDERS_EMAIL_ENABLED=0 → no email rows, no sends', async () => {
    await setOperatorKey('LEARNER_REMINDERS_EMAIL_ENABLED', '0')

    const teacher = await makeTeacher('lrd-off-t')
    const learner = await makeLearner('lrd-off-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
    })
    if (skipIfBandWalkOvershoot('test', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    // The TG path may still run (helper presence-detection); however no
    // learner is opted-in so no TG rows. Email is off → no email rows.
    const emailRows = rows.filter((r) => r.channel === 'email')
    expect(emailRows).toHaveLength(0)
    expect(stubSendCount).toBe(0)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Send-failure path
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — send failure', () => {
  it('stub-Resend 500 → dispatch row finalized as skipped/send_failed (no retry)', async () => {
    setStubBehaviour('fail_500')
    const teacher = await makeTeacher('lrd-sf-t')
    const learner = await makeLearner('lrd-sf-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
    })
    if (skipIfBandWalkOvershoot('test', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('skipped')
    expect(rows[0].skippedReason).toBe('send_failed')
    expect(rows[0].lastError).not.toBeNull()
    expect(stubSendCount).toBe(1)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Deletion-grace gate (§0d primary protection)
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — deletion-grace gate', () => {
  it('learner with disabled_at + scheduled_purge_at set → SELECT filters them out, no row, no send', async () => {
    const teacher = await makeTeacher('lrd-dg-t')
    const learner = await makeLearner('lrd-dg-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
    })
    if (skipIfBandWalkOvershoot('test', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )
    await getDbPool().query(
      `update accounts
          set disabled_at = now(),
              scheduled_purge_at = now() + interval '30 days'
        where id = $1::uuid`,
      [learner],
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(0)
    expect(stubSendCount).toBe(0)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Past-send-by — catch-up replay
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — catch-up replay (past_send_by)', () => {
  it('slot whose due moment is already past → row written as skipped/past_send_by, no send', async () => {
    // Window > actual delta + 5 → start_at - now() < window*60 - 30s
    // → catch-up gate fires past_send_by. Works regardless of MSK
    // wall-clock because we size the window relative to actualMinutes.
    const teacher = await makeTeacher('lrd-pb-t')
    const learner = await makeLearner('lrd-pb-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 5,
    })
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      String(Math.min(360, seeded.actualMinutes + 30)),
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('skipped')
    expect(rows[0].skippedReason).toBe('past_send_by')
    expect(stubSendCount).toBe(0)
  }, 30_000)
})

// ----------------------------------------------------------------------
// Rate limit
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — rate limit', () => {
  it('seed 5 due slots with RATE_LIMIT_PER_TICK=3 → 3 sent + 2 skipped/past_send_by', async () => {
    // Cap = 3, total = 5. We need 5 distinct (teacher, start_at)
    // cells. Use 5 DIFFERENT teachers + one shared base offset; this
    // sidesteps the unique constraint that walking-forward would
    // collide if all slots landed in the same next-day cell.
    await setOperatorKey('LEARNER_REMINDERS_RATE_LIMIT_PER_TICK', '3')

    let largestActual = 0
    for (let i = 0; i < 5; i += 1) {
      const teacher = await makeTeacher(`lrd-rl-t-${i}`)
      const learner = await makeLearner(`lrd-rl-l-${i}`)
      const seeded = await seedBookedSlot({
        teacherId: teacher,
        learnerId: learner,
        startInMinutes: 60,
      })
      if (seeded.actualMinutes > largestActual) {
        largestActual = seeded.actualMinutes
      }
    }
    // Window covers all 5 (they all land in the same cell).
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(largestActual),
    )

    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    const emailRows = rows.filter((r) => r.channel === 'email')
    expect(emailRows).toHaveLength(5)
    const sentRows = emailRows.filter((r) => r.status === 'sent')
    const skippedRows = emailRows.filter(
      (r) => r.status === 'skipped' && r.skippedReason === 'past_send_by',
    )
    expect(sentRows).toHaveLength(3)
    expect(skippedRows).toHaveLength(2)
    expect(stubSendCount).toBe(3)

    const run = await readLatestProbeRun()
    expect(run.stats).not.toBeNull()
    expect(run.stats!.sends_overflowed_rate_limit).toBe(2)
  }, 60_000)
})

// ----------------------------------------------------------------------
// FK ON DELETE RESTRICT
// ----------------------------------------------------------------------

describe('learner-reminder-dispatch.mjs — FK ON DELETE RESTRICT', () => {
  it('attempt to DELETE accounts row with a dispatch row → 23503 FK violation', async () => {
    const teacher = await makeTeacher('lrd-fk-t')
    const learner = await makeLearner('lrd-fk-l')
    const seeded = await seedBookedSlot({
      teacherId: teacher,
      learnerId: learner,
      startInMinutes: 60,
    })
    if (skipIfBandWalkOvershoot('test', seeded)) return
    await setOperatorKey(
      'LEARNER_REMINDER_WINDOW_MINUTES',
      windowMinutesForSlot(seeded.actualMinutes),
    )
    await runScheduler({ RESEND_API_KEY: 're_stub_key' })

    const rows = await readDispatches()
    expect(rows).toHaveLength(1)

    // Force-delete the learner — FK should refuse because
    // learner_reminder_dispatches.account_id is ON DELETE RESTRICT.
    await expect(
      getDbPool().query(`delete from accounts where id = $1::uuid`, [learner]),
    ).rejects.toThrow(
      // The error message contains either "violates foreign key
      // constraint" (English) or the SQLSTATE 23503 — pg surfaces
      // both. Match on the SQLSTATE.
      /23503|foreign key/i,
    )
  }, 30_000)
})
