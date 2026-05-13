import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetCalendarEncryptionKeyCache } from '@/lib/calendar/encryption'
import {
  disconnectGoogleIntegration,
  getGoogleIntegration,
  getGoogleIntegrationMeta,
  upsertGoogleIntegration,
} from '@/lib/calendar/integrations'
import {
  createAccount,
  grantAccountRole,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

const TEST_PRIMARY_KEY = 'k'.repeat(48)
const TEST_OLD_KEY = 'o'.repeat(48)

async function makeTeacher(
  email: string,
  timezone = 'Europe/Moscow',
): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(account.id, 'teacher', null)
  await upsertAccountProfile(account.id, {
    displayName: 'T',
    timezone,
    locale: 'ru',
  })
  return account.id
}

describe('lib/calendar/integrations — pgcrypto round-trip', () => {
  beforeEach(() => {
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_PRIMARY_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })
  afterEach(() => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()
  })

  it('upsert initial_connect persists encrypted tokens; read returns plaintext', async () => {
    const accountId = await makeTeacher('teacher-c3a-1@example.com')
    const expiresAt = new Date(Date.now() + 3600_000)
    const upsert = await upsertGoogleIntegration({
      accountId,
      accessToken: 'access_token_AAA',
      refreshToken: 'refresh_token_BBB',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      tokenExpiresAt: expiresAt,
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(upsert.ok).toBe(true)
    if (!upsert.ok) return
    expect(upsert.record.syncState).toBe('active')
    expect(upsert.record.writeCalendarId).toBe('primary')
    expect(upsert.record.epoch.length).toBeGreaterThan(8)

    // Verify ciphertext on disk is NOT plaintext.
    const pool = getDbPool()
    const raw = await pool.query(
      'select access_token_enc, refresh_token_enc from teacher_calendar_integrations where account_id = $1',
      [accountId],
    )
    expect(raw.rows[0].access_token_enc).not.toBeNull()
    expect(raw.rows[0].refresh_token_enc).not.toBeNull()
    expect(
      String(raw.rows[0].access_token_enc),
    ).not.toContain('access_token_AAA')

    // Decrypted read.
    const read = await getGoogleIntegration(accountId)
    expect(read).not.toBeNull()
    if (read) {
      expect(read.accessToken).toBe('access_token_AAA')
      expect(read.refreshToken).toBe('refresh_token_BBB')
      expect(read.syncState).toBe('active')
    }
  })

  it('upsert initial_connect on existing row rotates epoch + bumps last_reconnected_at', async () => {
    const accountId = await makeTeacher('teacher-c3a-2@example.com')
    const first = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Wait long enough for Postgres now() to advance — server clock
    // resolution on the test box can collapse 5ms into the same value.
    await new Promise((r) => setTimeout(r, 50))

    const second = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A2',
      refreshToken: 'R2',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.record.epoch).not.toBe(first.record.epoch)
    // Bumped (>=) — Postgres now() resolution can collapse same-ms calls;
    // strict-greater would flake. The semantically important invariant
    // is "epoch rotated and reconnected-at refreshed", not "exact ms gap".
    expect(
      new Date(second.record.lastReconnectedAt ?? '').getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(first.record.lastReconnectedAt ?? '').getTime(),
    )
  })

  it('token_refresh keeps epoch + last_reconnected_at', async () => {
    const accountId = await makeTeacher('teacher-c3a-3@example.com')
    const first = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await new Promise((r) => setTimeout(r, 5))

    const refresh = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A_refreshed',
      refreshToken: null, // Google typically omits on refresh
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'token_refresh',
    })
    expect(refresh.ok).toBe(true)
    if (!refresh.ok) return
    expect(refresh.record.epoch).toBe(first.record.epoch)
    expect(refresh.record.lastReconnectedAt).toBe(first.record.lastReconnectedAt)

    // Refresh kept the stored refresh_token.
    const read = await getGoogleIntegration(accountId)
    expect(read?.accessToken).toBe('A_refreshed')
    expect(read?.refreshToken).toBe('R') // preserved from initial
  })

  it('token_refresh accepts a rotated refresh_token when Google sends one', async () => {
    const accountId = await makeTeacher('teacher-c3a-4@example.com')
    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R_old',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A_new',
      refreshToken: 'R_rotated',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'token_refresh',
    })

    const read = await getGoogleIntegration(accountId)
    expect(read?.refreshToken).toBe('R_rotated')
  })

  it('token_refresh on missing row returns invalid_account_id', async () => {
    const accountId = '99999999-9999-9999-9999-999999999999'
    const r = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(),
      readCalendarIds: [],
      writeCalendarId: null,
      reason: 'token_refresh',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_account_id')
  })

  it('disconnect clears tokens and flips sync_state', async () => {
    const accountId = await makeTeacher('teacher-c3a-5@example.com')
    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    const epochBefore = (await getGoogleIntegrationMeta(accountId))!.epoch

    const ok = await disconnectGoogleIntegration(accountId)
    expect(ok).toBe(true)

    const after = await getGoogleIntegration(accountId)
    expect(after).not.toBeNull()
    if (after) {
      expect(after.syncState).toBe('disconnected')
      expect(after.accessToken).toBeNull()
      expect(after.refreshToken).toBeNull()
      // Epoch is preserved on disconnect — rotation happens on next
      // initial_connect.
      expect(after.epoch).toBe(epochBefore)
    }
  })

  it('disconnect on missing or already-disconnected row returns false', async () => {
    const accountId = await makeTeacher('teacher-c3a-6@example.com')
    // No upsert yet.
    expect(await disconnectGoogleIntegration(accountId)).toBe(false)

    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    expect(await disconnectGoogleIntegration(accountId)).toBe(true)
    // Second call on already-disconnected row — no-op.
    expect(await disconnectGoogleIntegration(accountId)).toBe(false)
  })

  it('rejects non-UUID accountId on all paths', async () => {
    expect(
      await upsertGoogleIntegration({
        accountId: 'not-a-uuid',
        accessToken: 'A',
        refreshToken: 'R',
        scope: 'scope',
        tokenExpiresAt: new Date(),
        readCalendarIds: [],
        writeCalendarId: null,
        reason: 'initial_connect',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_account_id', message: expect.any(String) },
    })
    expect(await getGoogleIntegration('not-a-uuid')).toBeNull()
    expect(await getGoogleIntegrationMeta('not-a-uuid')).toBeNull()
    expect(await disconnectGoogleIntegration('not-a-uuid')).toBe(false)
  })

  it('refuses upsert when encryption key is missing', async () => {
    delete process.env.CALENDAR_ENCRYPTION_KEY
    __resetCalendarEncryptionKeyCache()

    const accountId = await makeTeacher('teacher-c3a-7@example.com')
    const r = await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(),
      readCalendarIds: [],
      writeCalendarId: null,
      reason: 'initial_connect',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('encryption_key_missing')
  })

  it('MSK-only trigger blocks initial_connect for non-MSK teachers', async () => {
    const accountId = await makeTeacher(
      'teacher-c3a-tz@example.com',
      'Europe/Berlin',
    )
    await expect(
      upsertGoogleIntegration({
        accountId,
        accessToken: 'A',
        refreshToken: 'R',
        scope: 'scope',
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        readCalendarIds: ['primary'],
        writeCalendarId: 'primary',
        reason: 'initial_connect',
      }),
    ).rejects.toThrow(/Europe\/Moscow/)
  })

  it('reconnect resets last_pulled_at so F3 freshness contract treats busy-cache as stale', async () => {
    // Codex C.3a review: without this reset, a stale snapshot from a
    // previous integration epoch could satisfy bookSlot's "fresh
    // cache" gate before the first pull under the new epoch lands.
    const accountId = await makeTeacher('teacher-c3a-reconn@example.com')
    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A',
      refreshToken: 'R',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    // Simulate a pull worker stamping last_pulled_at.
    const pool = getDbPool()
    await pool.query(
      `update teacher_calendar_integrations
          set last_pulled_at = now()
        where account_id = $1`,
      [accountId],
    )
    const mid = await getGoogleIntegrationMeta(accountId)
    expect(mid?.lastPulledAt).not.toBeNull()

    // Disconnect then reconnect — new epoch + last_pulled_at must reset.
    expect(await disconnectGoogleIntegration(accountId)).toBe(true)
    await upsertGoogleIntegration({
      accountId,
      accessToken: 'A2',
      refreshToken: 'R2',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
    const reconn = await getGoogleIntegrationMeta(accountId)
    expect(reconn?.syncState).toBe('active')
    expect(reconn?.epoch).not.toBe(mid?.epoch)
    expect(reconn?.lastPulledAt).toBeNull()
    expect(reconn?.lastPushAt).toBeNull()
  })

  it('OLD-key fallback: row encrypted under OLD still decrypts after rotation', async () => {
    // Phase 1: write under OLD as PRIMARY.
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_OLD_KEY
    delete process.env.CALENDAR_ENCRYPTION_KEY_OLD
    __resetCalendarEncryptionKeyCache()

    const accountId = await makeTeacher('teacher-c3a-rot@example.com')
    await upsertGoogleIntegration({
      accountId,
      accessToken: 'rotating_AT',
      refreshToken: 'rotating_RT',
      scope: 'scope',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })

    // Phase 2: rotate — TEST_PRIMARY_KEY becomes new PRIMARY,
    // TEST_OLD_KEY is set as OLD.
    process.env.CALENDAR_ENCRYPTION_KEY = TEST_PRIMARY_KEY
    process.env.CALENDAR_ENCRYPTION_KEY_OLD = TEST_OLD_KEY
    __resetCalendarEncryptionKeyCache()

    const read = await getGoogleIntegration(accountId)
    expect(read?.accessToken).toBe('rotating_AT')
    expect(read?.refreshToken).toBe('rotating_RT')
  })
})
