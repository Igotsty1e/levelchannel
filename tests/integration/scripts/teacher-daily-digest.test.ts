import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// BCS-DEF-5 (2026-05-19) — integration tests for the daily teacher
// digest cron. Plan: docs/plans/bcs-def-5-teacher-reminders.md §3.3.
//
// Strategy: rather than spawning the cron via execFile (which couples
// us to the systemd shape + wall-clock timing), we import the
// exported helpers from scripts/teacher-daily-digest.mjs and exercise
// them directly against real Postgres. The cron's top-level main()
// is just a 4-step wiring of these helpers + recordProbeRun.

const here = dirname(fileURLToPath(import.meta.url))
const mjsPath = resolvePath(here, '../../../scripts/teacher-daily-digest.mjs')

type DigestModule = typeof import('../../../scripts/teacher-daily-digest.mjs')

let mod: DigestModule

beforeEach(async () => {
  // Dynamic import once per file — the cron's top-level imports run
  // here. Subsequent re-imports return the cached module.
  if (!mod) {
    mod = (await import(mjsPath)) as DigestModule
  }
  const pool = getDbPool()
  // Clean digest + probe_runs tables; setup.ts truncate doesn't touch
  // them.
  await pool.query(`delete from teacher_account_daily_digests`)
  await pool.query(`delete from probe_runs`)
})

afterEach(async () => {
  const pool = getDbPool()
  await pool.query(`delete from teacher_account_daily_digests`)
  await pool.query(`delete from probe_runs`)
})

async function makeTeacher(opts: {
  emailPrefix: string
  timezone?: string | null
  displayName?: string | null
}): Promise<string> {
  const id = await createAccount({
    email: normalizeAccountEmail(
      `${opts.emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  }).then((a) => a.id)
  await grantAccountRole(id, 'teacher', null)
  if (opts.timezone !== undefined || opts.displayName !== undefined) {
    await getDbPool().query(
      `insert into account_profiles (account_id, timezone, display_name)
         values ($1::uuid, $2, $3)
       on conflict (account_id) do update set
         timezone = excluded.timezone,
         display_name = excluded.display_name,
         updated_at = now()`,
      [id, opts.timezone ?? null, opts.displayName ?? null],
    )
  }
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

async function seedBookedSlot(opts: {
  teacherId: string
  learnerId: string
  startAtUtcIso: string
  zoomUrl?: string | null
}): Promise<string> {
  const pool = getDbPool()
  const ins = await pool.query(
    `insert into lesson_slots
       (id, teacher_account_id, start_at, duration_minutes, status)
       values (gen_random_uuid(), $1::uuid, $2::timestamptz, 60, 'open')
       returning id`,
    [opts.teacherId, opts.startAtUtcIso],
  )
  const slotId = String(ins.rows[0].id)
  await pool.query(
    `update lesson_slots
        set status = 'booked',
            learner_account_id = $1::uuid,
            booked_at = now(),
            zoom_url = $2
      where id = $3::uuid`,
    [opts.learnerId, opts.zoomUrl ?? null, slotId],
  )
  return slotId
}

// Compute an ISO timestamp for `today_msk` at `localHour:00` MSK
// (UTC+3). Aligns to 30-min boundary so the
// lesson_slots_start_30min_aligned CHECK passes. Pinning to MSK lets
// the seed slot land on "today_local in MSK" exactly, matching the
// candidate query's `today AT TIME ZONE 'Europe/Moscow'::date`
// projection regardless of when CI runs.
async function todayMskIsoAtHour(localHour: number): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query(
    `select (
       date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
       + ($1::int || ' hours')::interval
     ) AT TIME ZONE 'Europe/Moscow' as ts`,
    [localHour],
  )
  return new Date(String(r.rows[0].ts)).toISOString()
}

// Compute a JS Date object representing today MSK 08:00:00 (= 05:00
// UTC). The candidate-set query uses Postgres now() and projects to
// MSK; our JS now uses the SAME wall-clock day as Postgres but at the
// firing-band-passing 08:00 MSK instant. This keeps the JS-computed
// ymd in lockstep with Postgres-computed their_today_local.
async function tickNowInFiringBand(): Promise<Date> {
  const pool = getDbPool()
  const r = await pool.query(
    `select (
       date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
       + interval '8 hours'
     ) AT TIME ZONE 'Europe/Moscow' as ts`,
  )
  return new Date(String(r.rows[0].ts))
}

// Sibling of tickNowInFiringBand but at 11:00 MSK — outside the
// [07:59:00, 08:01:00] firing band.
async function tickNowOutsideFiringBand(): Promise<Date> {
  const pool = getDbPool()
  const r = await pool.query(
    `select (
       date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
       + interval '11 hours'
     ) AT TIME ZONE 'Europe/Moscow' as ts`,
  )
  return new Date(String(r.rows[0].ts))
}

// Build a stub resendSend that captures every call.
function makeResendStub(behaviour: 'success' | 'failure' = 'success') {
  const calls: Array<{
    from: string
    to: string[]
    subject: string
    text: string
    html: string
    idempotencyKey: string
  }> = []
  const send = async (params: {
    from: string
    to: string[]
    subject: string
    text: string
    html: string
    idempotencyKey: string
  }) => {
    calls.push(params)
    if (behaviour === 'success') {
      return { ok: true as const, emailId: 'stub-email-id-12345' }
    }
    return { ok: false as const, message: 'stub-transient-failure' }
  }
  return { calls, send }
}

describe('nowInTimezoneParts + isWithinFiringBand', () => {
  it('07:59:00 → inside band', () => {
    const now = new Date('2026-06-01T04:59:00.000Z') // 07:59 MSK
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(hms).toBe('07:59:00')
    expect(mod.isWithinFiringBand(hms)).toBe(true)
  })
  it('08:00:30 → inside band', () => {
    const now = new Date('2026-06-01T05:00:30.000Z') // 08:00:30 MSK
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(mod.isWithinFiringBand(hms)).toBe(true)
  })
  it('08:01:00 → inside band (inclusive upper edge)', () => {
    const now = new Date('2026-06-01T05:01:00.000Z') // 08:01 MSK
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(mod.isWithinFiringBand(hms)).toBe(true)
  })
  it('08:01:30 → outside band', () => {
    const now = new Date('2026-06-01T05:01:30.000Z') // 08:01:30 MSK
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(mod.isWithinFiringBand(hms)).toBe(false)
  })
  it('07:58:30 → outside band', () => {
    const now = new Date('2026-06-01T04:58:30.000Z') // 07:58:30 MSK
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(mod.isWithinFiringBand(hms)).toBe(false)
  })
  it('TZ-shift: 08:00 UTC is 11:00 Europe/Moscow → outside band', () => {
    const now = new Date('2026-06-01T08:00:00.000Z')
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(hms.startsWith('11:00')).toBe(true)
    expect(mod.isWithinFiringBand(hms)).toBe(false)
  })
  it('TZ-shift: 05:00 UTC is 08:00 Europe/Moscow → inside band', () => {
    const now = new Date('2026-06-01T05:00:00.000Z')
    const { hms } = mod.nowInTimezoneParts(now, 'Europe/Moscow')
    expect(hms.startsWith('08:00')).toBe(true)
    expect(mod.isWithinFiringBand(hms)).toBe(true)
  })
})

describe('selectCandidateTeachers — gates', () => {
  it('candidate set excludes teachers with no booked slots', async () => {
    await makeTeacher({ emailPrefix: 'no-slot-teacher' })
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates).toHaveLength(0)
  })

  it('candidate set includes a teacher with one booked slot in the 36h window', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'one-slot-teacher',
      timezone: 'Europe/Moscow',
      displayName: 'Анна',
    })
    const learnerId = await makeLearner('learner')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({
      teacherId,
      learnerId,
      startAtUtcIso: startAt,
    })
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates.length).toBe(1)
    expect(candidates[0].accountId).toBe(teacherId)
    expect(candidates[0].rawTz).toBe('Europe/Moscow')
    expect(candidates[0].displayName).toBe('Анна')
  })

  it('candidate set excludes disabled accounts', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'disabled-teacher',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-d')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })
    await getDbPool().query(
      `update accounts set disabled_at = now() where id = $1::uuid`,
      [teacherId],
    )
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates).toHaveLength(0)
  })

  it('candidate set excludes scheduled_purge_at non-null', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'purging-teacher',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-p')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })
    await getDbPool().query(
      `update accounts set scheduled_purge_at = now() + interval '30 days'
        where id = $1::uuid`,
      [teacherId],
    )
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates).toHaveLength(0)
  })

  it('candidate set excludes terminal rows (email_sent=true)', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'already-sent-teacher',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-s')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })

    // Insert a terminal sent row for "their today".
    await getDbPool().query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, sent_at)
         values ($1::uuid,
                 (now() AT TIME ZONE 'Europe/Moscow')::date,
                 true,
                 now())`,
      [teacherId],
    )
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates).toHaveLength(0)
  })

  it('candidate set excludes rows that have hit max_attempts', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'max-attempts-teacher',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-m')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })

    // Row at attempts=3, max_attempts=3 → excluded by candidate query.
    await getDbPool().query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, attempts)
         values ($1::uuid,
                 (now() AT TIME ZONE 'Europe/Moscow')::date,
                 false, 3)`,
      [teacherId],
    )
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates).toHaveLength(0)
  })

  it('candidate set includes retry-eligible rows (attempts < max)', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'retry-teacher',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-r')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })

    await getDbPool().query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, attempts)
         values ($1::uuid,
                 (now() AT TIME ZONE 'Europe/Moscow')::date,
                 false, 1)`,
      [teacherId],
    )
    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates.length).toBe(1)
  })
})

describe('processOneTeacher — verdict paths', () => {
  it('outside_band → no row written, no send', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'outside-band',
      timezone: 'Europe/Moscow',
      displayName: 'Учитель Тестовый',
    })
    const learnerId = await makeLearner('learner-ob')
    const startAt = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })

    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    const stub = makeResendStub('success')
    const outNow = await tickNowOutsideFiringBand() // 11:00 MSK today
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candidates[0],
      now: outNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })

    expect(result.outcome).toBe('outside_band')
    expect(stub.calls).toHaveLength(0)
    const rows = await getDbPool().query(
      `select * from teacher_account_daily_digests where account_id = $1`,
      [teacherId],
    )
    expect(rows.rowCount).toBe(0)
  })

  it('empty_day → writes flag row, no send', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'empty-day',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-ed')
    // Slot is YESTERDAY 23:30 MSK — outside the teacher's TODAY in MSK
    // but always within the 24h past window regardless of MSK time of
    // day. The previous fixture used "yesterday 15:00 MSK" which was
    // OUT of the 24h window when CI ran in the latter half of the
    // MSK day (yesterday 15:00 - now() 18:00 = 27h ago → flaky).
    // 23:30 MSK on a 30-min boundary satisfies
    // lesson_slots_start_30min_aligned and stays inside the band.
    const yesterdaySlot = await getDbPool().query(
      `select (
         date_trunc('day', now() AT TIME ZONE 'Europe/Moscow')
         - interval '1 day' + interval '23 hours 30 minutes'
       ) AT TIME ZONE 'Europe/Moscow' as ts`,
    )
    const startAt = new Date(String(yesterdaySlot.rows[0].ts)).toISOString()
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: startAt })

    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates.length).toBe(1)

    const stub = makeResendStub('success')
    // Use a real-ish "in-band" time so the firing band gate passes.
    const tickNow = await tickNowInFiringBand()
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candidates[0],
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })

    expect(result.outcome).toBe('empty_day')
    expect(stub.calls).toHaveLength(0)
    const rows = await getDbPool().query(
      `select email_sent, skipped_reason from teacher_account_daily_digests
        where account_id = $1`,
      [teacherId],
    )
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0].email_sent).toBe(false)
    expect(rows.rows[0].skipped_reason).toBe('empty_day')
  })

  it('sent → email_sent=true with resend_email_id captured', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'happy-send',
      timezone: 'Europe/Moscow',
      displayName: 'Анна',
    })
    const learnerId = await makeLearner('learner-hs')
    // Slot today at 15:00 MSK.
    const slotUtc = await todayMskIsoAtHour(15)
    await seedBookedSlot({
      teacherId,
      learnerId,
      startAtUtcIso: slotUtc,
      zoomUrl: 'https://meet.google.com/abc-defg-hij',
    })

    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(candidates.length).toBe(1)

    const stub = makeResendStub('success')
    const tickNow = await tickNowInFiringBand()
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candidates[0],
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })

    expect(result.outcome).toBe('sent')
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].subject).toContain('1 занятие на сегодня')
    expect(stub.calls[0].text).toContain('15:00 — учащийся')
    expect(stub.calls[0].text).toContain('Войти: https://meet.google.com/abc-defg-hij')

    const rows = await getDbPool().query(
      `select email_sent, sent_at, resend_email_id, attempts
         from teacher_account_daily_digests
        where account_id = $1`,
      [teacherId],
    )
    expect(rows.rows[0].email_sent).toBe(true)
    expect(rows.rows[0].sent_at).not.toBeNull()
    expect(rows.rows[0].resend_email_id).toBe('stub-email-id-12345')
    expect(Number(rows.rows[0].attempts)).toBe(1)
  })

  it('idempotency — second processOneTeacher call → already_sent, no second Resend hit', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'idempotent',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-id')
    const slotUtc = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: slotUtc })

    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    const stub = makeResendStub('success')
    const tickNow = await tickNowInFiringBand()
    await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candidates[0],
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })

    // Re-fetch candidates after first send (should now be empty —
    // terminal row excluded by the LEFT JOIN filter).
    const after = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(after).toHaveLength(0)
    expect(stub.calls).toHaveLength(1)
  })

  it('send_failed_transient on first attempt → row remains pending with last_error', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'transient-fail',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-tf')
    const slotUtc = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: slotUtc })

    const candidates = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    const stub = makeResendStub('failure')
    const tickNow = await tickNowInFiringBand()
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candidates[0],
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })

    expect(result.outcome).toBe('send_failed_transient')
    const rows = await getDbPool().query(
      `select email_sent, skipped_reason, attempts, last_error
         from teacher_account_daily_digests where account_id = $1`,
      [teacherId],
    )
    expect(rows.rows[0].email_sent).toBe(false)
    expect(rows.rows[0].skipped_reason).toBeNull()
    expect(Number(rows.rows[0].attempts)).toBe(1)
    expect(rows.rows[0].last_error).toBe('stub-transient-failure')

    // Re-running with same candidate (now retry-eligible) bumps attempts.
    const cand2 = await mod.selectCandidateTeachers(getDbPool(), 3, 200)
    expect(cand2).toHaveLength(1)
    await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: cand2[0],
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })
    const rows2 = await getDbPool().query(
      `select attempts from teacher_account_daily_digests where account_id = $1`,
      [teacherId],
    )
    expect(Number(rows2.rows[0].attempts)).toBe(2)
  })

  it('terminal_send_failed → after attempts >= max_attempts, row flips to skipped_reason=send_failed', async () => {
    const teacherId = await makeTeacher({
      emailPrefix: 'terminal-send-failed',
      timezone: 'Europe/Moscow',
    })
    const learnerId = await makeLearner('learner-tsf')
    const slotUtc = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: slotUtc })

    // Pre-seed a row at attempts=3 with skipped_reason=NULL (the
    // state that comes from 3 consecutive transient failures).
    await getDbPool().query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, attempts)
         values ($1::uuid,
                 (now() AT TIME ZONE 'Europe/Moscow')::date,
                 false, 3)`,
      [teacherId],
    )
    // Candidate-set query excludes this row (attempts >= max), so we
    // synthesize the candidate manually (mirrors a stale candidate set
    // computed pre-bump and processed after).
    const candFake = {
      accountId: teacherId,
      accountEmail: (
        await getDbPool().query(
          `select email from accounts where id = $1`,
          [teacherId],
        )
      ).rows[0].email,
      rawTz: 'Europe/Moscow',
      displayName: null,
      theirTodayLocal: new Date().toISOString().slice(0, 10),
    }
    const stub = makeResendStub('success')
    const tickNow = await tickNowInFiringBand()
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candFake,
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })
    expect(result.outcome).toBe('terminal_send_failed')

    const rows = await getDbPool().query(
      `select skipped_reason from teacher_account_daily_digests
        where account_id = $1`,
      [teacherId],
    )
    expect(rows.rows[0].skipped_reason).toBe('send_failed')
  })

  it('safeTimezone fallback — non-IANA tz on candidate (defensive) → Europe/Moscow used', async () => {
    // Migration 0064 normalizes legacy non-IANA rows to NULL, so a row
    // with a literal bad tz cannot exist post-migration. This test
    // verifies the JS-side safeTimezone() defensive layer holds even
    // if a candidate were constructed with a bad rawTz string.
    const teacherId = await makeTeacher({
      emailPrefix: 'bad-tz-defensive',
      timezone: null,
    })
    const learnerId = await makeLearner('learner-bt')
    const slotUtc = await todayMskIsoAtHour(15)
    await seedBookedSlot({ teacherId, learnerId, startAtUtcIso: slotUtc })

    const accountEmail = (
      await getDbPool().query(`select email from accounts where id = $1`, [
        teacherId,
      ])
    ).rows[0].email
    const candFake = {
      accountId: teacherId,
      accountEmail: String(accountEmail),
      rawTz: 'garbage-not-an-iana-name',
      displayName: null,
      theirTodayLocal: new Date().toISOString().slice(0, 10),
    }
    const stub = makeResendStub('success')
    const tickNow = await tickNowInFiringBand()
    const result = await mod.processOneTeacher({
      pool: getDbPool(),
      candidate: candFake,
      now: tickNow,
      maxAttempts: 3,
      resendSend: stub.send,
    })
    // Should land in 'sent' because safeTimezone() returns
    // Europe/Moscow → in-band → slot lookup succeeds.
    expect(result.outcome).toBe('sent')
  })
})

describe('migration 0069 — account_profiles_timezone_iana_check', () => {
  it('rejects non-IANA timezone insert', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({
      emailPrefix: 'check-rejects',
    })
    // Try to UPDATE the profile to a bad tz — should fail the CHECK.
    let raised: string | null = null
    try {
      await pool.query(
        `insert into account_profiles (account_id, timezone)
           values ($1::uuid, 'Australia/Sydney')`,
        [teacherId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).not.toBeNull()
    expect(raised).toMatch(/account_profiles_timezone_iana_check/)
  })

  it('accepts allowlisted IANA timezone', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-allows' })
    await pool.query(
      `insert into account_profiles (account_id, timezone)
         values ($1::uuid, 'Asia/Vladivostok')`,
      [teacherId],
    )
    const r = await pool.query(
      `select timezone from account_profiles where account_id = $1`,
      [teacherId],
    )
    expect(r.rows[0].timezone).toBe('Asia/Vladivostok')
  })

  it('accepts NULL timezone', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-null' })
    await pool.query(
      `insert into account_profiles (account_id, timezone)
         values ($1::uuid, NULL)`,
      [teacherId],
    )
    const r = await pool.query(
      `select timezone from account_profiles where account_id = $1`,
      [teacherId],
    )
    expect(r.rows[0].timezone).toBeNull()
  })
})

describe('migration 0067 — teacher_account_daily_digests state-machine CHECK', () => {
  it('rejects email_sent=true without sent_at', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-no-sent-at' })
    let raised: string | null = null
    try {
      await pool.query(
        `insert into teacher_account_daily_digests
           (account_id, sent_date, email_sent)
           values ($1::uuid, current_date, true)`,
        [teacherId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).toMatch(/tadd_state_consistency/)
  })

  it('rejects email_sent=true with skipped_reason non-null', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({
      emailPrefix: 'check-conflict-sent',
    })
    let raised: string | null = null
    try {
      await pool.query(
        `insert into teacher_account_daily_digests
           (account_id, sent_date, email_sent, sent_at, skipped_reason)
           values ($1::uuid, current_date, true, now(), 'empty_day')`,
        [teacherId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).toMatch(/tadd_state_consistency/)
  })

  it('rejects invalid skipped_reason value', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-bad-reason' })
    let raised: string | null = null
    try {
      await pool.query(
        `insert into teacher_account_daily_digests
           (account_id, sent_date, email_sent, skipped_reason)
           values ($1::uuid, current_date, false, 'bogus_reason')`,
        [teacherId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).not.toBeNull()
  })

  it('accepts pending row (email_sent=false, skipped_reason=NULL, attempts=0)', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-pending' })
    await pool.query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, attempts)
         values ($1::uuid, current_date, false, 0)`,
      [teacherId],
    )
    const r = await pool.query(
      `select count(*)::int as n from teacher_account_daily_digests
        where account_id = $1`,
      [teacherId],
    )
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('accepts empty_day terminal row', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-empty-day' })
    await pool.query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, skipped_reason)
         values ($1::uuid, current_date, false, 'empty_day')`,
      [teacherId],
    )
    const r = await pool.query(
      `select count(*)::int as n from teacher_account_daily_digests
        where account_id = $1`,
      [teacherId],
    )
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('PK rejects duplicate (account_id, sent_date)', async () => {
    const pool = getDbPool()
    const teacherId = await makeTeacher({ emailPrefix: 'check-pk-dup' })
    await pool.query(
      `insert into teacher_account_daily_digests
         (account_id, sent_date, email_sent, skipped_reason)
         values ($1::uuid, current_date, false, 'empty_day')`,
      [teacherId],
    )
    let raised: string | null = null
    try {
      await pool.query(
        `insert into teacher_account_daily_digests
           (account_id, sent_date, email_sent)
           values ($1::uuid, current_date, false)`,
        [teacherId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).toMatch(/tadd_pk|unique|duplicate/i)
  })
})

describe('migration 0068 — probe_runs CHECK widening for teacher-daily-digest', () => {
  it('accepts probe_name=teacher-daily-digest + digest_sent', async () => {
    await getDbPool().query(
      `insert into probe_runs (probe_name, verdict_kind, stats)
         values ('teacher-daily-digest', 'digest_sent', '{}'::jsonb)`,
    )
    const r = await getDbPool().query(
      `select count(*)::int as n from probe_runs
        where probe_name = 'teacher-daily-digest'`,
    )
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('accepts digest_skipped_disabled + digest_no_teachers', async () => {
    await getDbPool().query(
      `insert into probe_runs (probe_name, verdict_kind, stats)
         values
           ('teacher-daily-digest', 'digest_skipped_disabled', '{}'::jsonb),
           ('teacher-daily-digest', 'digest_no_teachers', '{}'::jsonb)`,
    )
    const r = await getDbPool().query(
      `select count(*)::int as n from probe_runs
        where probe_name = 'teacher-daily-digest'`,
    )
    expect(Number(r.rows[0].n)).toBe(2)
  })

  it('rejects bogus verdict_kind', async () => {
    let raised: string | null = null
    try {
      await getDbPool().query(
        `insert into probe_runs (probe_name, verdict_kind)
           values ('teacher-daily-digest', 'bogus_kind')`,
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).toMatch(/probe_runs_verdict_kind_check/)
  })

  it('still accepts the 4 pre-existing probe names', async () => {
    for (const name of [
      'auth-flow',
      'calendar-pathology',
      'webhook-flow',
      'conflict-unresolved',
    ]) {
      await getDbPool().query(
        `insert into probe_runs (probe_name, verdict_kind)
           values ($1, 'ok')`,
        [name],
      )
    }
    const r = await getDbPool().query(`select count(*)::int as n from probe_runs`)
    expect(Number(r.rows[0].n)).toBe(4)
  })
})
