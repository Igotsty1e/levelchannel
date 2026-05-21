// BCS-DEF-5-TG (2026-05-21) — Telegram block helper for the daily
// teacher digest cron.
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.4.1.
//
// Invoked from scripts/teacher-daily-digest.mjs ONLY on the
// `sendResult.ok` branch (i.e. after the email TX-A committed). Opens
// its own short TX-B on the same `client`; commits or rolls back its
// own TX in every branch.
//
// Race-safety: SELECT ... FOR UPDATE row lock + guarded UPDATE with
// state-machine WHERE clause + RETURNING.
//
// Auto-unsubscribe: Telegram 403 ("bot blocked by user") flips
// accounts.teacher_telegram_enabled=false (scoped to the SAME chat_id
// to defend against the re-bind race).
//
// Token redaction: every error string crossing into the dedup row or a
// log line passes through redactTelegramSecret BEFORE the 1000-char
// slice.

import {
  redactTelegramSecret,
  stringifyTelegramError,
} from './telegram-alerts.mjs'

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'teacher-daily-digest',
      block: 'telegram',
      msg,
      ...extra,
    }),
  )
}

/**
 * @param {{
 *   client: import('pg').PoolClient,
 *   accountId: string,
 *   ymd: string,
 *   telegramEnabled: boolean,
 *   tgToken: string,
 *   tgSend: (args: { botToken: string, chatId: string, text: string, retryMax?: number }) => Promise<{ ok: true, messageId?: string | null } | { ok: false, error?: string, detail?: string }>,
 *   body: string,
 * }} input
 * @returns {Promise<{ tg: 'sent' | 'skipped_disabled' | 'skipped_no_binding' | 'bot_blocked' | 'terminal_send_failed' | 'already_sent' | 'row_missing', messageId?: string | null, error?: string }>}
 */
export async function runTeacherTelegramBlock({
  client,
  accountId,
  ymd,
  telegramEnabled,
  tgToken,
  tgSend,
  body,
}) {
  try {
    await client.query('begin')

    // Step 1 — defense-in-depth fast-path: master switch OFF. In
    // production this branch is unreachable because the call site
    // guards `if (telegramEnabled && tgToken)` (per §2.4.2). Retained
    // so unit tests can drive the disabled-channel skip path cleanly.
    if (!telegramEnabled) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'channel_disabled'
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd],
      )
      await client.query('commit')
      return { tg: r.rowCount > 0 ? 'skipped_disabled' : 'row_missing' }
    }

    // Step 2 — look up binding on accounts. SAME source-of-truth as
    // BCS-DEF-4-TG; no separate subscriptions table. FOR UPDATE
    // serialises with /stop unbind + cabinet unbind on this account.
    const bindingRow = await client.query(
      `select teacher_telegram_enabled as enabled,
              teacher_telegram_chat_id as chat_id
         from accounts
        where id = $1
          and disabled_at is null
          and scheduled_purge_at is null
          and purged_at is null
        for update`,
      [accountId],
    )
    if (
      bindingRow.rowCount === 0
      || bindingRow.rows[0].enabled !== true
      || !bindingRow.rows[0].chat_id
    ) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'no_telegram_binding'
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd],
      )
      await client.query('commit')
      return { tg: r.rowCount > 0 ? 'skipped_no_binding' : 'row_missing' }
    }
    const chatId = String(bindingRow.rows[0].chat_id)

    // Step 3 — read dedup row WITH ROW LOCK. Eliminates the read-then-
    // update race (round-1 BLOCKER 5 closure).
    const existing = await client.query(
      `select telegram_sent, telegram_skipped_reason, telegram_attempts
         from teacher_account_daily_digests
        where account_id = $1 and sent_date = $2::date
        for update`,
      [accountId, ymd],
    )
    if (existing.rowCount === 0) {
      // Defensive: the email path just committed an UPDATE on this row
      // so it MUST exist. If we see 0 rows here, it indicates a deep
      // invariant break (e.g. row deleted under our lock by an
      // unexpected path).
      await client.query('rollback')
      logJson('warn', 'dedup row missing after email commit', {
        accountId,
        ymd,
      })
      return { tg: 'row_missing' }
    }
    const row = existing.rows[0]
    if (row.telegram_sent === true) {
      await client.query('rollback')
      return { tg: 'already_sent' }
    }
    if (row.telegram_skipped_reason !== null) {
      await client.query('rollback')
      return { tg: 'already_sent' }
    }

    // Step 4 — race-safe attempts bump. The candidate-set SQL excludes
    // any teacher with email_sent=true, so this helper runs AT MOST
    // ONCE per (account_id, sent_date). The guarded UPDATE detects
    // races where another path has already flipped a terminal state.
    const bumped = await client.query(
      `update teacher_account_daily_digests
          set telegram_attempts = telegram_attempts + 1
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null
        returning telegram_attempts`,
      [accountId, ymd],
    )
    if (bumped.rowCount === 0) {
      await client.query('rollback')
      return { tg: 'already_sent' }
    }

    // Step 5 — send. Within-helper retry budget (retryMax=2 ⇒ up to 3
    // attempts inside this single helper call). ANY failure after that
    // is IMMEDIATELY terminal — there is NO across-tick retry budget
    // (candidate-set filter excludes email_sent=true on subsequent
    // ticks; §6 RISK-2).
    const result = await tgSend({
      botToken: tgToken,
      chatId,
      text: body,
      retryMax: 2,
    })

    // Step 6 — success.
    if (result.ok) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_sent = true,
                telegram_sent_at = now(),
                telegram_message_id = $3,
                telegram_last_error = null
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null
          returning telegram_message_id`,
        [accountId, ymd, result.messageId ?? null],
      )
      if (r.rowCount === 0) {
        // SHOULD BE UNREACHABLE under the FOR UPDATE row lock from
        // step 3. R2-7 closure: log at error level — this indicates a
        // deeper invariant break, not a benign race.
        await client.query('rollback')
        logJson(
          'error',
          'success UPDATE affected 0 rows — invariant break',
          { accountId, ymd },
        )
        return { tg: 'already_sent' }
      }
      await client.query('commit')
      return { tg: 'sent', messageId: result.messageId ?? null }
    }

    // Step 7 — 403 ⇒ auto-unsubscribe + terminal. UPDATE scoped to
    // chat_id so a fresh re-bind under a different chat_id is not
    // retroactively wiped.
    if (
      typeof result.error === 'string'
      && result.error.startsWith('telegram_403')
    ) {
      const redactedDetail = redactTelegramSecret(
        result.detail ?? '',
        tgToken,
      ).slice(0, 1000)
      const unbindR = await client.query(
        `update accounts
            set teacher_telegram_enabled = false
          where id = $1
            and teacher_telegram_chat_id = $2`,
        [accountId, chatId],
      )
      if (unbindR.rowCount === 0) {
        // Benign: chat_id changed under us (re-bind happened between
        // step-5 send and step-7 unbind). New binding's chat_id is
        // different; leave it alone.
        logJson(
          'info',
          '403 auto-unbind matched 0 rows (re-bind race)',
          { accountId },
        )
      }
      const dedupR = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'bot_blocked_by_user',
                telegram_last_error = $3
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd, redactedDetail],
      )
      if (dedupR.rowCount === 0) {
        logJson(
          'error',
          '403 dedup UPDATE affected 0 rows — invariant break',
          { accountId, ymd },
        )
      }
      await client.query('commit')
      return { tg: 'bot_blocked' }
    }

    // Step 8 — non-403 failure: IMMEDIATELY terminal. CHECK constraint's
    // "Retryable terminal (send_failed)" branch requires attempts >= 1;
    // step 4 incremented attempts from 0 to 1, so the CHECK is satisfied.
    const errorString = String(result.detail ?? result.error ?? 'unknown')
    const redactedError = redactTelegramSecret(errorString, tgToken).slice(
      0,
      1000,
    )
    const terminalR = await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'send_failed',
              telegram_last_error = $3
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null`,
      [accountId, ymd, redactedError],
    )
    if (terminalR.rowCount === 0) {
      logJson(
        'error',
        'send_failed UPDATE affected 0 rows — invariant break',
        { accountId, ymd },
      )
    }
    await client.query('commit')
    return { tg: 'terminal_send_failed', error: result.error }
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      /* swallow rollback errors */
    }
    logJson('warn', 'block crashed', {
      accountId,
      ymd,
      err: redactTelegramSecret(stringifyTelegramError(err), tgToken),
    })
    return { tg: 'terminal_send_failed', error: 'block_crashed' }
  }
}
