import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { futureSlotIso } from '../helpers'

// BCS-DEF-1-TEST-FILLOUT items 1 + 2 (2026-05-19) — execFile-driven
// integration coverage of scripts/conflict-unresolved-alert.mjs.
//
// Item 1: pin every VERDICT_KIND the probe can land in `probe_runs`
// (no_offenders / alert_sent / dedup_skip / alert_send_failed /
// config_missing / error). Mirrors the per-probe pattern in
// tests/integration/admin/probe-resolver-integration.test.ts which
// already execFile-s auth-flow-alert.mjs, calendar-pathology-alert.mjs
// and webhook-flow-alert.mjs.
//
// Item 2: fairness regression — 100×3-teacher seed (60/30/10) pins
// the `ROW_NUMBER() OVER (PARTITION BY teacher_account_id ...)`
// contract in scripts/conflict-unresolved-alert.mjs § readOffenderRows.
//
// Resend mocking: the probe is invoked as a SEPARATE node process
// (execFile), so `vi.mock('resend', …)` cannot intercept the SDK in
// the child. Instead we exploit the Resend SDK's `RESEND_BASE_URL`
// env hook (node_modules/resend/dist/index.mjs) and point the child
// at a localhost HTTP stub server we control. The stub's per-test
// response shape drives the alert_sent / alert_send_failed branches.

const execFileP = promisify(execFile)

type StubBehaviour = 'success' | 'fail_500'

// Spin up a tiny HTTP server impersonating https://api.resend.com.
// One server per test file (cheap; reused across describe blocks).
// Behaviour swapped per-test via the `setStubBehaviour` setter.
let stubServer: Server | null = null
let stubPort = 0
let stubBehaviour: StubBehaviour = 'success'
let lastStubBody: unknown = null
let lastStubAuthHeader: string | null = null

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
      try {
        lastStubBody = raw ? JSON.parse(raw) : null
      } catch {
        lastStubBody = raw
      }
      lastStubAuthHeader = req.headers['authorization'] ?? null
      if (stubBehaviour === 'success') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        // Mirror Resend's POST /emails 200 shape: { id: '...' }.
        res.end(JSON.stringify({ id: 'stub-email-id-12345' }))
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        // Resend's error envelope shape: { statusCode, message, name }.
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

// Per-test state-file directory: the probe writes a JSON dedup-state
// file (default ./var/conflict-unresolved-state.json). Each test gets
// its own tmpdir to keep dedup state hermetic across test ordering.
let stateDir: string

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'cu-alert-state-'))
  // Reset stub default each test.
  setStubBehaviour('success')
  lastStubBody = null
  lastStubAuthHeader = null
  // The setup.ts truncate doesn't touch probe_runs / operator_settings;
  // wipe them locally so each test starts clean.
  const pool = getDbPool()
  await pool.query(`delete from probe_runs`)
})

afterEach(async () => {
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true })
  }
  // Same probe_runs cleanup on the way out so a later non-probe test
  // doesn't trip on leftover rows.
  await getDbPool().query(`delete from probe_runs`)
})

function stateFilePath(): string {
  return join(stateDir, 'state.json')
}

function probeUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set in the test harness')
  return url
}

function probeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: probeUrl(),
    CONFLICT_UNRESOLVED_STATE_FILE: stateFilePath(),
    // Point Resend SDK at our localhost stub instead of api.resend.com.
    // The probe will still run the full `await resend.emails.send(...)`
    // code path; only the network destination is different.
    RESEND_BASE_URL: `http://127.0.0.1:${stubPort}`,
    ...extra,
  } as NodeJS.ProcessEnv
}

async function runProbe(
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  const r = await execFileP(
    process.execPath,
    ['scripts/conflict-unresolved-alert.mjs'],
    { env: probeEnv(env), cwd: process.cwd() },
  )
  return { stdout: r.stdout, stderr: r.stderr }
}

async function readLatestProbeRun(): Promise<{
  verdictKind: string
  recipientEmail: string | null
  fingerprint: string | null
  stats: Record<string, unknown> | null
  alertSent: boolean
  alertEmailId: string | null
  errorMessage: string | null
}> {
  const r = await getDbPool().query(
    `select verdict_kind, recipient_email, fingerprint, stats,
            alert_sent, alert_email_id, error_message
       from probe_runs
      where probe_name = 'conflict-unresolved' and is_test = false
      order by ran_at desc limit 1`,
  )
  if (!r.rows[0]) {
    throw new Error('expected at least one conflict-unresolved probe_run row')
  }
  return {
    verdictKind: String(r.rows[0].verdict_kind),
    recipientEmail: r.rows[0].recipient_email
      ? String(r.rows[0].recipient_email)
      : null,
    fingerprint: r.rows[0].fingerprint
      ? String(r.rows[0].fingerprint)
      : null,
    stats: (r.rows[0].stats as Record<string, unknown> | null) ?? null,
    alertSent: Boolean(r.rows[0].alert_sent),
    alertEmailId: r.rows[0].alert_email_id
      ? String(r.rows[0].alert_email_id)
      : null,
    errorMessage: r.rows[0].error_message
      ? String(r.rows[0].error_message)
      : null,
  }
}

// Make a teacher account in the shape the probe filters on:
// purged_at=null, disabled_at=null, email non-empty.
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

// The probe SELECTs against `accounts a` only for the teacher (FK
// `lesson_slots.teacher_account_id`). The learner FK only requires a
// row to exist in `accounts`; no role is needed on the learner side
// for any of the probe's WHERE clauses. We therefore create a bare
// account with no role grant — keeps the fixture minimal and side-
// steps the `account_roles_role_check` (admin/teacher/student) enum.
async function makeLearner(emailPrefix: string): Promise<string> {
  const id = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  }).then((a) => a.id)
  return id
}

// Seed a single booked, future, conflict-stamped slot. The probe
// SELECTs rows where status='booked' AND start_at > now() AND
// external_conflict_at <= now() - threshold. Two-step insert keeps
// the lesson_slots_booked_invariants CHECK happy (status=booked
// requires learner_account_id and booked_at).
//
// `minutesOffset` chooses which 30-min business-band cell via
// futureSlotIso() — unique offsets yield unique (teacher, start_at)
// pairs so the seed never collides with the unique index.
async function seedConflictingSlot(opts: {
  teacherId: string
  learnerId: string
  minutesOffset: number
  conflictAgeMinutes: number
  externalCalendarId?: string | null
  externalEventId?: string | null
}): Promise<string> {
  const startAt = futureSlotIso(opts.minutesOffset)
  const pool = getDbPool()
  const ins = await pool.query(
    `insert into lesson_slots (
       id, teacher_account_id, start_at, duration_minutes, status
     ) values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
     returning id`,
    [opts.teacherId, startAt],
  )
  const slotId = String(ins.rows[0].id)
  await pool.query(
    `update lesson_slots
        set status = 'booked',
            learner_account_id = $1::uuid,
            booked_at = now(),
            external_conflict_at = now() - ($2::int || ' minutes')::interval,
            external_conflict_kind = 'post_book_overlap',
            conflict_source_calendar_id = $3::text,
            conflict_source_event_id = $4::text
      where id = $5::uuid`,
    [
      opts.learnerId,
      opts.conflictAgeMinutes,
      opts.externalCalendarId ?? 'primary',
      opts.externalEventId ?? `evt-${slotId.slice(0, 8)}`,
      slotId,
    ],
  )
  return slotId
}

// ----------------------------------------------------------------------
// Item 1 — VERDICT_KIND coverage.
// ----------------------------------------------------------------------

describe('conflict-unresolved-alert.mjs — VERDICT_KIND coverage (Item 1)', () => {
  it('no offenders → verdict_kind=no_offenders, stats has thresholds+source, fingerprint null', async () => {
    // Empty lesson_slots; expect the early-return NO_OFFENDERS path.
    const { stdout } = await runProbe()
    // The probe emits a json info line; not strictly load-bearing.
    expect(stdout.length).toBeGreaterThanOrEqual(0)
    const row = await readLatestProbeRun()
    expect(row.verdictKind).toBe('no_offenders')
    expect(row.fingerprint).toBeNull()
    expect(row.alertSent).toBe(false)
    expect(row.recipientEmail).toBeNull()
    expect(row.stats).not.toBeNull()
    const stats = row.stats!
    expect(stats.totalConflicts).toBe(0)
    expect(stats.totalTeachers).toBe(0)
    const thresholds = stats.thresholds as Record<string, unknown>
    expect(thresholds.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES).toBe(120)
    expect(thresholds.CONFLICT_UNRESOLVED_REPORT_LIMIT).toBe(50)
    expect(thresholds.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT).toBe(5)
    expect(thresholds.CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS).toBe(
      4 * 3600 * 1000,
    )
    const tSource = stats.thresholds_source as Record<string, unknown>
    expect(tSource.CONFLICT_UNRESOLVED_THRESHOLD_MINUTES).toBe('default')
  }, 30_000)

  it('config_missing (ALERT_EMAIL_TO unset, RESEND_API_KEY set) → verdict_kind=config_missing + error_message + state file NOT written', async () => {
    const teacher = await makeTeacher('cu-cm-t')
    const learner = await makeLearner('cu-cm-l')
    await seedConflictingSlot({
      teacherId: teacher,
      learnerId: learner,
      minutesOffset: 60,
      conflictAgeMinutes: 180, // >120-min default threshold
    })

    await runProbe({
      // ALERT_EMAIL_TO INTENTIONALLY ABSENT (we don't set it here).
      RESEND_API_KEY: 're_present_but_destination_missing',
    })

    const row = await readLatestProbeRun()
    expect(row.verdictKind).toBe('config_missing')
    expect(row.errorMessage).toBe('missing_alert_email_to')
    expect(row.fingerprint).not.toBeNull()
    expect(row.alertSent).toBe(false)
    // recipient_email recorded as `ALERT_EMAIL_TO || null` snapshot —
    // missing env → null snapshot.
    expect(row.recipientEmail).toBeNull()

    // State file MUST NOT have been written: the config_missing branch
    // never advances state so the next tick re-fires.
    await expect(readFile(stateFilePath(), 'utf8')).rejects.toThrow(
      /ENOENT/,
    )
  }, 30_000)

  it('alert_sent (stub Resend 200) → verdict_kind=alert_sent, recipient/email-id set, state file advanced, fingerprint stable', async () => {
    const teacher = await makeTeacher('cu-as-t')
    const learner = await makeLearner('cu-as-l')
    await seedConflictingSlot({
      teacherId: teacher,
      learnerId: learner,
      minutesOffset: 60,
      conflictAgeMinutes: 240,
    })

    setStubBehaviour('success')
    await runProbe({
      ALERT_EMAIL_TO: 'ops-test@example.com',
      RESEND_API_KEY: 're_stub_key_routed_to_localhost',
      EMAIL_FROM: 'LevelChannel <noreply@example.com>',
    })

    const row = await readLatestProbeRun()
    expect(row.verdictKind).toBe('alert_sent')
    expect(row.alertSent).toBe(true)
    expect(row.recipientEmail).toBe('ops-test@example.com')
    expect(row.alertEmailId).toBe('stub-email-id-12345')
    expect(row.fingerprint).not.toBeNull()
    expect(row.stats).not.toBeNull()
    const stats = row.stats!
    expect(stats.totalConflicts).toBe(1)
    expect(stats.totalTeachers).toBe(1)
    expect(stats.shown).toBe(1)

    // Stub server received an email-build payload with the configured
    // sender + recipient. This is the "assert email build path" pin —
    // proves the probe actually constructed buildEmail(...) output and
    // shipped it through resend.emails.send(...) rather than skipping.
    expect(lastStubAuthHeader).toBe('Bearer re_stub_key_routed_to_localhost')
    const sent = lastStubBody as {
      from?: string
      to?: string[]
      subject?: string
      text?: string
    }
    expect(sent).not.toBeNull()
    expect(sent.from).toBe('LevelChannel <noreply@example.com>')
    expect(sent.to).toEqual(['ops-test@example.com'])
    expect(typeof sent.subject).toBe('string')
    expect(sent.subject!).toMatch(/Нерешённые конфликты/)
    expect(typeof sent.text).toBe('string')
    expect(sent.text!).toMatch(/operator-настройка/)

    // State file MUST have been advanced — next tick within dedup
    // window will hit DEDUP_SKIP.
    const state = JSON.parse(await readFile(stateFilePath(), 'utf8')) as {
      lastAlertAt: number
      lastFingerprint: string
    }
    expect(typeof state.lastAlertAt).toBe('number')
    expect(state.lastFingerprint).toBe(row.fingerprint)
  }, 30_000)

  it('dedup_skip (second tick, unchanged fingerprint, within window) → verdict_kind=dedup_skip, no stub HTTP call', async () => {
    const teacher = await makeTeacher('cu-ds-t')
    const learner = await makeLearner('cu-ds-l')
    await seedConflictingSlot({
      teacherId: teacher,
      learnerId: learner,
      minutesOffset: 90,
      conflictAgeMinutes: 240,
    })

    // First tick: alert_sent + state advance.
    setStubBehaviour('success')
    await runProbe({
      ALERT_EMAIL_TO: 'ops-test@example.com',
      RESEND_API_KEY: 're_stub_key',
    })
    const first = await readLatestProbeRun()
    expect(first.verdictKind).toBe('alert_sent')
    const firstFingerprint = first.fingerprint!

    // Reset stub-trace before second tick so we can assert "stub NOT
    // called". If the dedup branch fires correctly, the probe returns
    // BEFORE the resend.emails.send() call.
    lastStubBody = null
    lastStubAuthHeader = null

    // Second tick: same data, state file still has matching fingerprint
    // + lastAlertAt within DEDUP_WINDOW_MS (4h default; we're seconds
    // apart). Expect DEDUP_SKIP.
    await runProbe({
      ALERT_EMAIL_TO: 'ops-test@example.com',
      RESEND_API_KEY: 're_stub_key',
    })
    const second = await readLatestProbeRun()
    expect(second.verdictKind).toBe('dedup_skip')
    expect(second.fingerprint).toBe(firstFingerprint)
    expect(second.alertSent).toBe(false)
    // The probe sets recipient_email only on send-path branches; the
    // DEDUP_SKIP branch leaves it null per scripts/conflict-unresolved-
    // alert.mjs (no recipientEmail in the recordProbeRun call).
    expect(second.recipientEmail).toBeNull()

    // Stub MUST NOT have been called on the second tick.
    expect(lastStubBody).toBeNull()
    expect(lastStubAuthHeader).toBeNull()
  }, 30_000)

  it('alert_send_failed (stub Resend 500) → verdict_kind=alert_send_failed, recipient captured, state file NOT advanced', async () => {
    const teacher = await makeTeacher('cu-sf-t')
    const learner = await makeLearner('cu-sf-l')
    await seedConflictingSlot({
      teacherId: teacher,
      learnerId: learner,
      minutesOffset: 120,
      conflictAgeMinutes: 360,
    })

    setStubBehaviour('fail_500')
    await runProbe({
      ALERT_EMAIL_TO: 'ops-test@example.com',
      RESEND_API_KEY: 're_stub_key_will_500',
    })

    const row = await readLatestProbeRun()
    expect(row.verdictKind).toBe('alert_send_failed')
    expect(row.alertSent).toBe(false)
    expect(row.recipientEmail).toBe('ops-test@example.com')
    expect(row.fingerprint).not.toBeNull()
    expect(row.errorMessage).toBeTruthy()

    // State file MUST NOT have been advanced — next tick re-tries the
    // same offender set. Mirrors the "Resend outage → state NOT
    // advanced" contract documented in the probe header.
    await expect(readFile(stateFilePath(), 'utf8')).rejects.toThrow(
      /ENOENT/,
    )

    // Stub WAS called (failed at the response layer, not before).
    expect(lastStubAuthHeader).toBe('Bearer re_stub_key_will_500')
  }, 30_000)

  // The `error` verdict (outer try/catch) only fires on UNEXPECTED
  // exceptions thrown out of the snapshot or DB-reader path. The
  // realistic triggers are PG outage / FK CASCADE mid-probe / a
  // SQL-shape regression in readOffenderRows. None of those are
  // hermetic to simulate without intrusive monkey-patching of the
  // child process. We rely on plan-§2 SQL-shape pinning + the
  // dedicated ERROR-shape unit tests for that branch and skip the
  // execFile coverage here. The other 5 verdict_kind paths above
  // exercise every public branch the operator can observe.
  it.skip('error (transient DB error path) — skipped: not hermetically simulatable via execFile', () => {})
})

// ----------------------------------------------------------------------
// Item 2 — Fairness regression: 100 slots × 3 teachers (60/30/10).
// ----------------------------------------------------------------------

describe('conflict-unresolved-alert.mjs — fairness regression (Item 2)', () => {
  it('100×3 (60/30/10) seed with per-teacher cap 5 → email body shows 5/5/5 with omitted tally 55/25/5, all 3 teachers present', async () => {
    // Distinct teachers so the email body has a stable per-teacher
    // grouping.
    const tA = await makeTeacher('cu-fair-a')
    const tB = await makeTeacher('cu-fair-b')
    const tC = await makeTeacher('cu-fair-c')
    // One learner is enough — booked_invariants only requires a non-
    // null learner; nothing in the probe filters on learner identity.
    const learner = await makeLearner('cu-fair-learner')

    // Use distinct minutesOffset per seeded slot so futureSlotIso()
    // returns a unique 30-min cell → unique (teacher, start_at) → no
    // FK violation on the unique index. Offsets are
    // teacher-index × 1000 + sequence × 60 so all 100 fit in distinct
    // cells. external_conflict_at is offset so the WITHIN-PARTITION
    // ORDER BY external_conflict_at asc has deterministic ties.
    async function seedBatch(
      teacherId: string,
      teacherTag: number,
      count: number,
    ): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        const minutesOffset = teacherTag * 10_000 + i * 60
        const ageMinutes = 360 + i // strictly > threshold, unique per row
        await seedConflictingSlot({
          teacherId,
          learnerId: learner,
          minutesOffset,
          conflictAgeMinutes: ageMinutes,
        })
      }
    }

    await seedBatch(tA, 1, 60)
    await seedBatch(tB, 2, 30)
    await seedBatch(tC, 3, 10)

    // Sanity: 100 booked, conflict-stamped, future slots seeded.
    const sanity = await getDbPool().query(
      `select count(*)::int as n
         from lesson_slots
        where status = 'booked' and external_conflict_at is not null`,
    )
    expect(sanity.rows[0].n).toBe(100)

    setStubBehaviour('success')
    // Explicitly set per-teacher and report limits to the contract
    // values from the task spec, even though they match the defaults.
    // Source-resolver lands env=env in stats.thresholds_source.
    await runProbe({
      ALERT_EMAIL_TO: 'ops-test@example.com',
      RESEND_API_KEY: 're_stub_key',
      CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: '5',
      CONFLICT_UNRESOLVED_REPORT_LIMIT: '50',
    })

    const row = await readLatestProbeRun()
    expect(row.verdictKind).toBe('alert_sent')
    expect(row.alertSent).toBe(true)
    const stats = row.stats!
    expect(stats.totalConflicts).toBe(100)
    expect(stats.totalTeachers).toBe(3)
    // Visible slice: 5 per teacher × 3 teachers = 15. report_limit=50
    // is permissive; the cap that bites here is per_teacher_limit=5.
    expect(stats.shown).toBe(15)
    const tSource = stats.thresholds_source as Record<string, unknown>
    expect(tSource.CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT).toBe('env')
    expect(tSource.CONFLICT_UNRESOLVED_REPORT_LIMIT).toBe('env')

    // Inspect the email body the stub captured: the load-bearing
    // fairness contract — per-teacher cap 5, omitted tally 55/25/5.
    const sent = lastStubBody as { subject?: string; text?: string }
    expect(typeof sent.text).toBe('string')
    const text = sent.text!

    // All three teachers present in the body (by their numeric
    // headcount, which is unique per teacher — 60 / 30 / 10).
    expect(text).toMatch(/60 конфликтов/) // teacher A
    expect(text).toMatch(/30 конфликтов/) // teacher B
    expect(text).toMatch(/10 конфликтов/) // teacher C

    // Per-teacher omitted tally: 55 / 25 / 5. The probe renders
    // these on the "... и ещё N конфликтов не показано у этого
    // учителя" line. (5 is also "конфликтов" by Russian
    // pluralization — mod10=5, mod100=5, "many" branch.)
    expect(text).toMatch(/и ещё 55 конфликтов у этого учителя/)
    expect(text).toMatch(/и ещё 25 конфликтов у этого учителя/)
    expect(text).toMatch(/и ещё 5 конфликтов у этого учителя/)

    // Per-teacher visible slot count = 5: count the bullet markers
    // ("   • слот ") in the body. With 3 teachers × 5 slots each, the
    // body MUST carry exactly 15 bullets. If the ROW_NUMBER() fairness
    // partition regressed (e.g. dropped PARTITION BY teacher), teacher
    // A would monopolise and we'd see >5 for A or <5 for B/C.
    const bulletMatches = text.match(/   • слот /g) ?? []
    expect(bulletMatches.length).toBe(15)

    // Header line "Показано: до 5 на учителя × 50 всего" pins the
    // probe's email-builder honesty about the active caps.
    expect(text).toMatch(/Показано: до 5 на учителя × 50 всего/)
  }, 60_000)
})
