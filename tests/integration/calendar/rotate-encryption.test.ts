import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// AUDIT-SEC-2 (2026-05-17) — end-to-end smoke test for
// scripts/rotate-calendar-encryption.mjs. Insert encrypted rows under
// OLD_KEY, run the rotation script with NEW_KEY=PRIMARY + OLD_KEY,
// verify rows now decrypt under NEW alone (i.e. the script flipped
// the ciphertext).

const execFileP = promisify(execFile)

const OLD_KEY = 'O'.repeat(48)
const NEW_KEY = 'N'.repeat(48)

async function makeTeacher(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(account.id, 'teacher', null)
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone: 'Europe/Moscow',
    locale: 'ru',
  })
  return account.id
}

beforeEach(() => {
  process.env.CALENDAR_ENCRYPTION_KEY = OLD_KEY
  __resetCalendarEncryptionKeyCache()
})

afterEach(() => {
  delete process.env.CALENDAR_ENCRYPTION_KEY
  delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
  __resetCalendarEncryptionKeyCache()
})

describe('scripts/rotate-calendar-encryption.mjs', () => {
  it('happy path: rotates token columns from OLD_KEY to NEW_KEY', async () => {
    const teacherId = await makeTeacher('rotate-cal@example.com')

    // Phase 1 — insert integration row encrypted under OLD_KEY.
    process.env.CALENDAR_ENCRYPTION_KEY = OLD_KEY
    __resetCalendarEncryptionKeyCache()
    const r = await upsertGoogleIntegration({
      accountId: teacherId,
      accessToken: 'AT-rotate',
      refreshToken: 'RT-rotate',
      scope: 's',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(r.ok).toBe(true)

    const pool = getDbPool()
    const before = await pool.query(
      `select
         pgp_sym_decrypt_either(access_token_enc, $1, null) as decrypted_old,
         pgp_sym_decrypt_either(access_token_enc, $2, null) as decrypted_new
       from teacher_calendar_integrations
       where account_id = $3`,
      [OLD_KEY, NEW_KEY, teacherId],
    )
    expect(before.rows[0].decrypted_old).toBe('AT-rotate')
    expect(before.rows[0].decrypted_new).toBeNull()

    // Phase 2 — spawn the rotation script with NEW=PRIMARY + OLD_KEY.
    await execFileP(
      process.execPath,
      ['scripts/rotate-calendar-encryption.mjs', '--batch-size', '10'],
      {
        env: {
          ...process.env,
          CALENDAR_ENCRYPTION_KEY: NEW_KEY,
          CALENDAR_ENCRYPTION_KEY_OLD: OLD_KEY,
        },
        cwd: process.cwd(),
      },
    )

    // Phase 3 — rows now decrypt under NEW alone.
    const after = await pool.query(
      `select
         pgp_sym_decrypt_either(access_token_enc, $1, null) as decrypted_old,
         pgp_sym_decrypt_either(access_token_enc, $2, null) as decrypted_new,
         pgp_sym_decrypt_either(refresh_token_enc, $1, null) as refresh_decrypted_old,
         pgp_sym_decrypt_either(refresh_token_enc, $2, null) as refresh_decrypted_new
       from teacher_calendar_integrations
       where account_id = $3`,
      [OLD_KEY, NEW_KEY, teacherId],
    )
    // The ciphertext was rewritten. Under NEW it must decrypt to the
    // original plaintext; under OLD it must NOT (or it's just-the-same
    // ciphertext, which would mean the script didn't run).
    expect(after.rows[0].decrypted_new).toBe('AT-rotate')
    expect(after.rows[0].decrypted_old).toBeNull()
    expect(after.rows[0].refresh_decrypted_new).toBe('RT-rotate')
    expect(after.rows[0].refresh_decrypted_old).toBeNull()
  }, 30_000)

  it('idempotent: re-running the script on already-rotated rows is a no-op (zero updates)', async () => {
    const teacherId = await makeTeacher('rotate-cal-idemp@example.com')

    // Already encrypted under PRIMARY=NEW from the start.
    process.env.CALENDAR_ENCRYPTION_KEY = NEW_KEY
    __resetCalendarEncryptionKeyCache()
    await upsertGoogleIntegration({
      accountId: teacherId,
      accessToken: 'AT-idemp',
      refreshToken: 'RT-idemp',
      scope: 's',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    const { stdout } = await execFileP(
      process.execPath,
      ['scripts/rotate-calendar-encryption.mjs', '--batch-size', '10'],
      {
        env: {
          ...process.env,
          CALENDAR_ENCRYPTION_KEY: NEW_KEY,
          CALENDAR_ENCRYPTION_KEY_OLD: OLD_KEY,
        },
        cwd: process.cwd(),
      },
    )
    // Script reports "nothing to do" for each rotation target.
    expect(stdout).toContain('nothing to do')
  }, 30_000)

  it('refuses to run when PRIMARY === OLD', async () => {
    let exitCode = 0
    try {
      await execFileP(
        process.execPath,
        ['scripts/rotate-calendar-encryption.mjs'],
        {
          env: {
            ...process.env,
            CALENDAR_ENCRYPTION_KEY: NEW_KEY,
            CALENDAR_ENCRYPTION_KEY_OLD: NEW_KEY,
          },
          cwd: process.cwd(),
        },
      )
    } catch (err) {
      exitCode = (err as { code?: number }).code ?? 0
    }
    expect(exitCode).toBe(2)
  })

  it('refuses to run when CALENDAR_ENCRYPTION_KEY_OLD is missing', async () => {
    let exitCode = 0
    try {
      const env = { ...process.env, CALENDAR_ENCRYPTION_KEY: NEW_KEY }
      delete (env as Record<string, string | undefined>).CALENDAR_ENCRYPTION_KEY_OLD
      await execFileP(
        process.execPath,
        ['scripts/rotate-calendar-encryption.mjs'],
        { env: env as NodeJS.ProcessEnv, cwd: process.cwd() },
      )
    } catch (err) {
      exitCode = (err as { code?: number }).code ?? 0
    }
    expect(exitCode).toBe(2)
  })

  // Round 1 WARN #2 closure — third rotation target
  // (teacher_external_busy_intervals.summary_encrypted) has a
  // different PK (`id`) and different ageColumn (`fetched_at`).
  // The happy-path test above only covers teacher_calendar_integrations;
  // any bug in the ROTATION_TARGETS branch / pkColumn dispatch for
  // the busy-intervals table would pass silently.
  it('happy path: rotates teacher_external_busy_intervals.summary_encrypted', async () => {
    const teacherId = await makeTeacher('rotate-cal-summary@example.com')
    const pool = getDbPool()

    // Insert a busy-interval row encrypted under OLD_KEY via the
    // same pgp_sym_encrypt path the pull-runner uses
    // (lib/calendar/pull-runner.ts:245).
    await pool.query(
      `insert into teacher_external_busy_intervals (
         teacher_account_id, external_calendar_id, external_event_id,
         start_at, end_at, summary_encrypted, is_all_day,
         is_writable_in_source, is_own_event, is_orphan_self,
         etag, fetched_at
       ) values (
         $1, 'primary', 'foreign-evt-summary-rotate',
         '2026-07-01T09:00:00Z'::timestamptz,
         '2026-07-01T10:00:00Z'::timestamptz,
         pgp_sym_encrypt('foreign meeting subject', $2::text),
         false, true, false, false, 'etag-1', now()
       )`,
      [teacherId, OLD_KEY],
    )

    const before = await pool.query(
      `select pgp_sym_decrypt_either(summary_encrypted, $1, null) as old_dec,
              pgp_sym_decrypt_either(summary_encrypted, $2, null) as new_dec
         from teacher_external_busy_intervals
        where external_event_id = 'foreign-evt-summary-rotate'`,
      [OLD_KEY, NEW_KEY],
    )
    expect(before.rows[0].old_dec).toBe('foreign meeting subject')
    expect(before.rows[0].new_dec).toBeNull()

    await execFileP(
      process.execPath,
      ['scripts/rotate-calendar-encryption.mjs', '--batch-size', '10'],
      {
        env: {
          ...process.env,
          CALENDAR_ENCRYPTION_KEY: NEW_KEY,
          CALENDAR_ENCRYPTION_KEY_OLD: OLD_KEY,
        },
        cwd: process.cwd(),
      },
    )

    const after = await pool.query(
      `select pgp_sym_decrypt_either(summary_encrypted, $1, null) as old_dec,
              pgp_sym_decrypt_either(summary_encrypted, $2, null) as new_dec
         from teacher_external_busy_intervals
        where external_event_id = 'foreign-evt-summary-rotate'`,
      [OLD_KEY, NEW_KEY],
    )
    expect(after.rows[0].new_dec).toBe('foreign meeting subject')
    expect(after.rows[0].old_dec).toBeNull()
  }, 30_000)

  // Round 1 WARN #3 closure — the wrong-OLD-key footgun preflight
  // is the most important safety guard. Without a test, the guard
  // could regress silently. Repro: encrypt under OLD_KEY, run
  // rotation with a DIFFERENT key as OLD (e.g. SHIFT_KEY) — script
  // must abort with exit 2 (some rows decrypt under NEITHER PRIMARY
  // nor the supplied OLD, indicating wrong OLD or a third key).
  it('refuses to proceed when supplied CALENDAR_ENCRYPTION_KEY_OLD does not decrypt existing rows', async () => {
    const teacherId = await makeTeacher('rotate-wrong-old@example.com')

    process.env.CALENDAR_ENCRYPTION_KEY = OLD_KEY
    __resetCalendarEncryptionKeyCache()
    const r = await upsertGoogleIntegration({
      accountId: teacherId,
      accessToken: 'AT-wrong-old',
      refreshToken: 'RT-wrong-old',
      scope: 's',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(r.ok).toBe(true)

    const SHIFT_KEY = 'S'.repeat(48)
    let exitCode = 0
    let combined = ''
    try {
      await execFileP(
        process.execPath,
        ['scripts/rotate-calendar-encryption.mjs', '--batch-size', '10'],
        {
          env: {
            ...process.env,
            CALENDAR_ENCRYPTION_KEY: NEW_KEY,
            CALENDAR_ENCRYPTION_KEY_OLD: SHIFT_KEY, // INTENTIONALLY WRONG
          },
          cwd: process.cwd(),
        },
      )
    } catch (err) {
      const e = err as { code?: number; stderr?: string; stdout?: string }
      exitCode = e.code ?? 0
      combined = (e.stderr ?? '') + (e.stdout ?? '')
    }
    expect(exitCode).toBe(2)
    // The abort line is load-bearing — verify the script surfaces
    // the diagnosis to the operator, not just an exit code. Match
    // the full operator-facing sentence so a future wording
    // regression on this safety-critical message gets caught.
    // Round-2 WARN #5 closure (2026-05-17).
    expect(combined).toMatch(
      /ABORT — \d+ rows in teacher_calendar_integrations\.access_token_enc are encrypted but decrypt under NEITHER PRIMARY nor the supplied OLD/,
    )
    expect(combined).toContain('CALENDAR_ENCRYPTION_KEY_OLD is likely wrong')
    expect(combined).toContain('Re-check both keys before re-running')
  }, 30_000)
})
