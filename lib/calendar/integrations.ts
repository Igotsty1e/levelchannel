// BCS-C.3a — DB store ops for teacher_calendar_integrations.
//
// Three operations: upsert (on initial connect or token refresh), read
// (decrypt-aware), disconnect (clear tokens + flip state). All token
// I/O goes through pgcrypto in SQL — plaintext tokens never leave the
// app/DB tx boundary.
//
// Schema reference: migrations/0043_teacher_calendar_integrations.sql
//   - access_token_enc / refresh_token_enc are bytea (pgp_sym_encrypt
//     output)
//   - sync_state machine: 'active' / 'degraded' / 'disconnected'
//   - epoch: rotated on every fresh connect (UUID; default
//     gen_random_uuid()::text)
//   - MSK-only trigger fires on INSERT/UPDATE into active/degraded
//
// Token encryption uses CALENDAR_ENCRYPTION_KEY (lib/calendar/encryption.ts)
// — separate from AUDIT_ENCRYPTION_KEY for blast-radius (plan §8 #6).
//
// Decrypt-aware reads use pgp_sym_decrypt_either(...) from migration
// 0027, which tries PRIMARY then OLD and returns NULL when both fail.

import {
  getCalendarEncryptionKey,
  getCalendarEncryptionKeyOld,
} from '@/lib/calendar/encryption'
import { getDbPool } from '@/lib/db/pool'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TeacherCalendarIntegrationRecord = {
  accountId: string
  provider: 'google'
  syncState: 'active' | 'degraded' | 'disconnected'
  epoch: string
  scope: string | null
  tokenExpiresAt: string | null
  readCalendarIds: string[]
  writeCalendarId: string | null
  lastPulledAt: string | null
  lastPushAt: string | null
  lastReconnectedAt: string | null
  lastError: string | null
  channelId: string | null
  channelResourceId: string | null
  channelExpiresAt: string | null
  channelToken: string | null
  lastSeenMessageNumber: string | null
  createdAt: string
  updatedAt: string
}

export type TeacherCalendarIntegrationWithTokens =
  TeacherCalendarIntegrationRecord & {
    // Decrypted on read via pgp_sym_decrypt_either. Null when the row
    // exists but tokens have been cleared (disconnect, or pre-token
    // pull/push state).
    accessToken: string | null
    refreshToken: string | null
  }

function rowToRecord(row: Record<string, unknown>): TeacherCalendarIntegrationRecord {
  return {
    accountId: String(row.account_id),
    provider: String(row.provider) as 'google',
    syncState: String(row.sync_state) as 'active' | 'degraded' | 'disconnected',
    epoch: String(row.epoch),
    scope: row.scope === null ? null : String(row.scope),
    tokenExpiresAt: row.token_expires_at
      ? new Date(String(row.token_expires_at)).toISOString()
      : null,
    readCalendarIds: Array.isArray(row.read_calendar_ids)
      ? (row.read_calendar_ids as string[]).map(String)
      : [],
    writeCalendarId:
      row.write_calendar_id === null ? null : String(row.write_calendar_id),
    lastPulledAt: row.last_pulled_at
      ? new Date(String(row.last_pulled_at)).toISOString()
      : null,
    lastPushAt: row.last_push_at
      ? new Date(String(row.last_push_at)).toISOString()
      : null,
    lastReconnectedAt: row.last_reconnected_at
      ? new Date(String(row.last_reconnected_at)).toISOString()
      : null,
    lastError: row.last_error === null ? null : String(row.last_error),
    channelId: row.channel_id === null ? null : String(row.channel_id),
    channelResourceId:
      row.channel_resource_id === null ? null : String(row.channel_resource_id),
    channelExpiresAt: row.channel_expires_at
      ? new Date(String(row.channel_expires_at)).toISOString()
      : null,
    channelToken: row.channel_token === null ? null : String(row.channel_token),
    lastSeenMessageNumber:
      row.last_seen_message_number === null
        ? null
        : String(row.last_seen_message_number),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export type UpsertGoogleIntegrationInput = {
  accountId: string
  accessToken: string
  // null on token refresh (Google omits) — keeps the existing stored
  // refresh_token. On initial connect (`prompt=consent`), Google
  // always returns a refresh_token so non-null is the typical case.
  refreshToken: string | null
  scope: string
  tokenExpiresAt: Date
  readCalendarIds: string[]
  writeCalendarId: string | null
  // Whether this upsert is an initial connect (rotates epoch + sets
  // last_reconnected_at) or a token refresh (keeps both fields).
  // Plan §4.5 (F9 gate): epoch rotation only on connect/reconnect,
  // never on a silent refresh.
  reason: 'initial_connect' | 'token_refresh'
}

export type UpsertError =
  | { code: 'encryption_key_missing'; message: string }
  | { code: 'invalid_account_id'; message: string }

export type UpsertResult =
  | { ok: true; record: TeacherCalendarIntegrationRecord }
  | { ok: false; error: UpsertError }

// Insert-or-update the integration row.
//
// On `initial_connect`: rotates `epoch` (new gen_random_uuid()) and
// bumps `last_reconnected_at = now()`. Empties the channel triple so
// the next pull-worker run will re-subscribe. Flips `sync_state` to
// 'active'.
//
// On `token_refresh`: keeps `epoch` and `last_reconnected_at`. Updates
// only access_token / refresh_token (if non-null) / token_expires_at /
// scope. Does NOT change sync_state — a successful refresh leaves the
// integration in whatever sync_state the pull worker last set.
export async function upsertGoogleIntegration(
  input: UpsertGoogleIntegrationInput,
): Promise<UpsertResult> {
  if (!UUID_PATTERN.test(input.accountId)) {
    return {
      ok: false,
      error: {
        code: 'invalid_account_id',
        message: 'accountId must be a UUID',
      },
    }
  }
  const key = getCalendarEncryptionKey()
  if (!key) {
    return {
      ok: false,
      error: {
        code: 'encryption_key_missing',
        message:
          'CALENDAR_ENCRYPTION_KEY is not configured. Set it before connecting Google Calendar.',
      },
    }
  }

  const pool = getDbPool()

  if (input.reason === 'initial_connect') {
    const r = await pool.query(
      `insert into teacher_calendar_integrations (
         account_id, provider,
         access_token_enc, refresh_token_enc,
         scope, token_expires_at,
         read_calendar_ids, write_calendar_id,
         sync_state, epoch, last_reconnected_at,
         channel_id, channel_resource_id, channel_expires_at, channel_token,
         channel_token_enc,
         last_seen_message_number,
         created_at, updated_at
       ) values (
         $1, 'google',
         pgp_sym_encrypt($2, $3),
         case when $4::text is null then null else pgp_sym_encrypt($4, $3) end,
         $5, $6,
         $7, $8,
         'active', gen_random_uuid()::text, now(),
         null, null, null, null,
         null,
         null,
         now(), now()
       )
       on conflict (account_id) do update set
         provider = 'google',
         access_token_enc = pgp_sym_encrypt($2, $3),
         refresh_token_enc = case when $4::text is null then null else pgp_sym_encrypt($4, $3) end,
         scope = $5,
         token_expires_at = $6,
         read_calendar_ids = $7,
         write_calendar_id = $8,
         sync_state = 'active',
         epoch = gen_random_uuid()::text,
         last_reconnected_at = now(),
         -- Codex C.3a review: reset last_pulled_at on reconnect. Old
         -- timestamp would otherwise satisfy the F3 freshness
         -- contract (bookSlot trusts busy-cache while
         -- last_pulled_at >= now() - 10min) using a snapshot from a
         -- previous integration epoch with potentially different
         -- read_calendar_ids. NULL forces the first pull under the
         -- new epoch to repopulate before busy intervals are
         -- consulted for booking decisions.
         last_pulled_at = null,
         last_push_at = null,
         channel_id = null,
         channel_resource_id = null,
         channel_expires_at = null,
         channel_token = null,
         channel_token_enc = null,
         last_seen_message_number = null,
         last_error = null,
         updated_at = now()
       returning *`,
      [
        input.accountId,
        input.accessToken,
        key,
        input.refreshToken,
        input.scope,
        input.tokenExpiresAt.toISOString(),
        input.readCalendarIds,
        input.writeCalendarId,
      ],
    )
    return { ok: true, record: rowToRecord(r.rows[0]) }
  }

  // token_refresh: same row, no epoch / reconnected_at bumps.
  const r = await pool.query(
    `update teacher_calendar_integrations
        set access_token_enc = pgp_sym_encrypt($2, $3),
            refresh_token_enc = coalesce(
              case when $4::text is null then null else pgp_sym_encrypt($4, $3) end,
              refresh_token_enc
            ),
            scope = $5,
            token_expires_at = $6,
            updated_at = now()
      where account_id = $1
      returning *`,
    [
      input.accountId,
      input.accessToken,
      key,
      input.refreshToken,
      input.scope,
      input.tokenExpiresAt.toISOString(),
    ],
  )
  if (r.rows.length === 0) {
    // Refresh path called on a row that doesn't exist — caller bug
    // (should have called initial_connect first). Treat as invalid.
    return {
      ok: false,
      error: {
        code: 'invalid_account_id',
        message: 'No existing integration to refresh for this account',
      },
    }
  }
  return { ok: true, record: rowToRecord(r.rows[0]) }
}

// Read the integration row including decrypted tokens. Returns null
// when no row exists. Token fields may be null even if the row exists
// (post-disconnect cleared state, or pre-write state if used before
// upsertGoogleIntegration lands).
//
// Uses pgp_sym_decrypt_either($enc, $primary, $old) so the same row
// stays readable through a key-rotation window where some rows are
// still encrypted under the OLD key. See migration 0027.
export async function getGoogleIntegration(
  accountId: string,
): Promise<TeacherCalendarIntegrationWithTokens | null> {
  if (!UUID_PATTERN.test(accountId)) return null
  const primary = getCalendarEncryptionKey()
  const old = getCalendarEncryptionKeyOld()
  const pool = getDbPool()
  const r = await pool.query(
    `select tci.*,
            case when access_token_enc is null or $2::text is null
              then null
              else pgp_sym_decrypt_either(access_token_enc, $2::text, $3::text)
            end as access_token_plain,
            case when refresh_token_enc is null or $2::text is null
              then null
              else pgp_sym_decrypt_either(refresh_token_enc, $2::text, $3::text)
            end as refresh_token_plain
       from teacher_calendar_integrations tci
      where account_id = $1`,
    [accountId, primary, old],
  )
  if (r.rows.length === 0) return null
  const row = r.rows[0]
  return {
    ...rowToRecord(row),
    accessToken:
      row.access_token_plain === null || row.access_token_plain === undefined
        ? null
        : String(row.access_token_plain),
    refreshToken:
      row.refresh_token_plain === null || row.refresh_token_plain === undefined
        ? null
        : String(row.refresh_token_plain),
  }
}

// Returns the integration shape WITHOUT tokens. Cheap read for cron
// sweeps / dashboards / settings UI where the plaintext token is not
// needed.
export async function getGoogleIntegrationMeta(
  accountId: string,
): Promise<TeacherCalendarIntegrationRecord | null> {
  if (!UUID_PATTERN.test(accountId)) return null
  const pool = getDbPool()
  const r = await pool.query(
    `select * from teacher_calendar_integrations where account_id = $1`,
    [accountId],
  )
  if (r.rows.length === 0) return null
  return rowToRecord(r.rows[0])
}

// Disconnect: clear tokens + flip sync_state. Plan §4.12 — DO NOT
// cascade-delete Google events; reconciliation handles drift on
// reconnect via the epoch field. The row itself stays so the existing
// epoch is preserved (it'll be rotated on the next initial_connect).
//
// Returns true if a row was updated, false if no integration existed.
export async function disconnectGoogleIntegration(
  accountId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(accountId)) return false
  const pool = getDbPool()
  const r = await pool.query(
    `update teacher_calendar_integrations
        set sync_state = 'disconnected',
            access_token_enc = null,
            refresh_token_enc = null,
            token_expires_at = null,
            channel_id = null,
            channel_resource_id = null,
            channel_expires_at = null,
            channel_token = null,
            channel_token_enc = null,
            last_seen_message_number = null,
            updated_at = now()
      where account_id = $1
        and sync_state <> 'disconnected'
      returning account_id`,
    [accountId],
  )
  return r.rows.length > 0
}
