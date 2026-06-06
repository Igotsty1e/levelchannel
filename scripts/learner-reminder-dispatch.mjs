#!/usr/bin/env node
//
// BCS-DEF-4 (2026-05-19) — learner lesson reminder scheduler.
//
// Plan: docs/plans/bcs-def-4-learner-reminders.md §2.4 (REVISED).
//
// Cron-driven scheduler — runs once per minute via the companion
// systemd timer (`levelchannel-learner-reminder-dispatch.timer`).
// Reads `lesson_slots` directly + writes per-slot-per-channel rows
// to `learner_reminder_dispatches` for idempotency.
//
// NOT structurally an alert probe (no dedup-fingerprint, no
// operator-storm semantics) — but emits one probe_runs row per tick
// so the operator can see "what was sent in the last 60 seconds"
// alongside the 4 alert probes on /admin/settings/alerts.
//
// Operator knobs (DB → env → default), per
// lib/admin/operator-settings.ts SETTING_SCHEMA +
// scripts/lib/operator-settings.mjs mirror:
//
//   LEARNER_REMINDERS_EMAIL_ENABLED       default 1   (0/1)
//   LEARNER_REMINDER_WINDOW_MINUTES       default 60  min:5    max:360
//   LEARNER_REMINDERS_RATE_LIMIT_PER_TICK default 200 min:1    max:5000
//
// Other env:
//   DATABASE_URL          — postgres connection
//   RESEND_API_KEY        — Resend SDK key (else console fallback)
//   EMAIL_FROM            — sender (reused from main app)
//   NEXT_PUBLIC_SITE_URL  — used to build /cabinet links in the body
//
// Idempotency:
//   - `INSERT INTO learner_reminder_dispatches (...) ON CONFLICT
//     DO NOTHING RETURNING id` is the atomic claim.
//   - A row stuck in `status='claimed'` indicates a worker crash
//     between INSERT and the success/skip UPDATE; the UNIQUE
//     constraint blocks any retry. Operator can DELETE the row to
//     unblock one manual retry.

import pg from 'pg'
import { Resend } from 'resend'

import { resolveSslConfig } from './_pg-ssl.mjs'
import { renderLearnerLessonReminderText } from './lib/learner-reminder-template.mjs'
import { renderLearnerPushPayload } from './lib/learner-push-template.mjs'
import { resolveOperatorSettingsForProbe } from './lib/operator-settings.mjs'
import { recordPushSubscriptionUnsubscribedAuto } from './lib/push-events.mjs'
import { sendWebPush } from './lib/web-push.mjs'
import {
  PROBE_NAMES,
  RECIPIENT_KINDS,
  VERDICT_KINDS,
  recordProbeRun,
} from './lib/probe-runs.mjs'

const PROBE_NAME = PROBE_NAMES.LEARNER_REMINDERS

const EMAIL_FROM =
  process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://levelchannel.ru'

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'learner-reminder-dispatch',
      msg,
      ...extra,
    }),
  )
}

// Try to detect whether scripts/lib/telegram-alerts.mjs exposes
// `sendTelegramMessage`. Cached at module-load. BCS-DEF-1-TG (already
// merged) ships the helper; if the import succeeds and the function
// is callable, the TG sub-loop activates. Otherwise the TG path is
// dormant (all TG dispatch rows finalize as
// status='skipped', skipped_reason='telegram_helper_not_shipped').
let telegramHelper = null
let telegramHelperResolved = false
async function resolveTelegramHelper() {
  if (telegramHelperResolved) return telegramHelper
  telegramHelperResolved = true
  try {
    const mod = await import('./lib/telegram-alerts.mjs')
    if (mod && typeof mod.sendTelegramMessage === 'function') {
      telegramHelper = mod
    }
  } catch {
    telegramHelper = null
  }
  return telegramHelper
}

// Truncate a string for `last_error` storage. Wave-paranoia precedent:
// keep <= 200 chars so the audit row stays bounded.
function truncate(str, max = 200) {
  if (str == null) return null
  const s = String(str)
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

// Pure helper for tests + scheduler. Returns one of:
//   { kind: 'sent', resendId: string|null }
//   { kind: 'skipped', reason: '<known reason>', detail?: string }
// `result` is the raw return of sendEmail/sendTelegramMessage.
export function classifyEmailResult(result) {
  if (result && result.ok === true) {
    return {
      kind: 'sent',
      resendId: result.id ?? null,
    }
  }
  return {
    kind: 'skipped',
    reason: 'send_failed',
    detail: result && 'error' in result ? truncate(result.error) : 'unknown',
  }
}

// --- DB readers ------------------------------------------------------

// SELECT every due slot for this tick. Plan §2.4 step 4 REVISED.
// Bounded by 2 × rateLimitPerTick as a safety net (NOT a send cap;
// the send cap is enforced row-by-row in step 6).
export async function readDueSlots(pool, opts) {
  const { windowMinutes, rateLimitPerTick, channel } = opts
  // dueMomentLower = now() + windowMinutes*60s - 30s (for catch-up,
  // §2.4 step 7 widens to now()).
  // dueMomentUpper = now() + windowMinutes*60s + 30s.
  const r = await pool.query(
    `
    SELECT s.id                AS slot_id,
           s.start_at,
           s.learner_account_id,
           s.teacher_account_id,
           s.zoom_url,
           s.duration_minutes,
           a.email              AS learner_email,
           a.disabled_at        AS learner_disabled_at,
           a.scheduled_purge_at AS learner_scheduled_purge_at,
           a.purged_at          AS learner_purged_at,
           a.learner_telegram_enabled,
           a.learner_telegram_chat_id,
           ap.display_name      AS learner_display_name,
           ap.timezone          AS learner_timezone,
           tap.display_name     AS teacher_display_name
      FROM lesson_slots s
      JOIN accounts a            ON a.id  = s.learner_account_id
      LEFT JOIN account_profiles ap  ON ap.account_id  = s.learner_account_id
      LEFT JOIN account_profiles tap ON tap.account_id = s.teacher_account_id
     WHERE s.status = 'booked'
       AND s.start_at > now()
       AND s.start_at <= now() + ($1::int || ' minutes')::interval + interval '30 seconds'
       AND a.disabled_at        IS NULL
       AND a.scheduled_purge_at IS NULL
       AND a.purged_at          IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM learner_reminder_dispatches d
          WHERE d.slot_id = s.id
            AND d.channel = $3::text
       )
     ORDER BY s.start_at ASC
     LIMIT (2 * $2::int)
    `,
    [windowMinutes, rateLimitPerTick, channel],
  )
  return r.rows.map((row) => ({
    slotId: String(row.slot_id),
    startAt: new Date(String(row.start_at)),
    learnerAccountId: String(row.learner_account_id),
    teacherAccountId: row.teacher_account_id
      ? String(row.teacher_account_id)
      : null,
    zoomUrl: row.zoom_url ? String(row.zoom_url) : null,
    durationMinutes: Number(row.duration_minutes),
    learnerEmail: row.learner_email ? String(row.learner_email) : null,
    learnerDisabledAt: row.learner_disabled_at
      ? new Date(String(row.learner_disabled_at))
      : null,
    learnerScheduledPurgeAt: row.learner_scheduled_purge_at
      ? new Date(String(row.learner_scheduled_purge_at))
      : null,
    learnerPurgedAt: row.learner_purged_at
      ? new Date(String(row.learner_purged_at))
      : null,
    learnerTelegramEnabled: Boolean(row.learner_telegram_enabled),
    learnerTelegramChatId: row.learner_telegram_chat_id
      ? String(row.learner_telegram_chat_id)
      : null,
    learnerDisplayName: row.learner_display_name
      ? String(row.learner_display_name)
      : null,
    learnerTimezone: row.learner_timezone
      ? String(row.learner_timezone)
      : null,
    teacherDisplayName: row.teacher_display_name
      ? String(row.teacher_display_name)
      : null,
  }))
}

// Re-fetch + gate at send time. Returns either:
//   { ok: true, currentRow }
//   { skipped: '<reason>' }  // proceed to UPDATE with this skipped_reason
async function reFetchAndGate(pool, slotId, windowMinutes) {
  const r = await pool.query(
    `
    SELECT s.status,
           s.start_at,
           a.disabled_at,
           a.scheduled_purge_at,
           a.purged_at,
           a.email AS learner_email
      FROM lesson_slots s
      JOIN accounts a ON a.id = s.learner_account_id
     WHERE s.id = $1::uuid
    `,
    [slotId],
  )
  const row = r.rows[0]
  if (!row) {
    // Slot vanished (would be unusual — FK is ON DELETE RESTRICT,
    // so this only happens if an operator manually DELETEd the row
    // and ignored the FK from learner_reminder_dispatches).
    return { skipped: 'slot_no_longer_booked' }
  }
  if (String(row.status) !== 'booked') {
    return { skipped: 'slot_no_longer_booked' }
  }
  // Catch-up gate: the reminder moment is in the past. start_at -
  // now() < windowMinutes*60s - 30s means we missed the window.
  const startAt = new Date(String(row.start_at))
  const dueLowerSec = windowMinutes * 60 - 30
  const remainingSec = (startAt.getTime() - Date.now()) / 1000
  if (remainingSec < dueLowerSec) {
    return { skipped: 'past_send_by' }
  }
  // Deletion-grace re-check.
  if (row.disabled_at || row.scheduled_purge_at || row.purged_at) {
    return { skipped: 'slot_no_longer_booked' }
  }
  // Email gate: an anonymised email from the retention sweep.
  const email = row.learner_email ? String(row.learner_email) : null
  if (!email || email.length === 0 || email.endsWith('@example.invalid')) {
    return { skipped: 'email_missing' }
  }
  return { ok: true, learnerEmail: email }
}

// --- Send paths ------------------------------------------------------

// Email send via Resend SDK. Mirror of lib/email/client.ts sendEmail
// — but the scheduler runs as a separate Node process (no Next.js
// boot, no @/ alias), so the SDK is invoked directly here. Tests
// override the Resend base URL via the RESEND_BASE_URL env var (the
// stub-server pattern used in the conflict-unresolved-alert tests).
async function sendOneEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  if (!apiKey) {
    // Dev / first-prod-run fallback — log to journal so the operator
    // can verify the scheduler runs even without Resend configured.
    logJson('info', 'email:console (RESEND_API_KEY not set)', {
      to,
      subject,
    })
    return { ok: true, transport: 'console', id: null }
  }
  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to: [to],
      subject,
      text,
    })
    if (result.error) {
      return {
        ok: false,
        transport: 'resend',
        error: result.error.message ?? String(result.error),
      }
    }
    return {
      ok: true,
      transport: 'resend',
      id: result.data?.id ?? null,
    }
  } catch (err) {
    return {
      ok: false,
      transport: 'resend',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// --- Tick driver -----------------------------------------------------

async function tick(pool) {
  // Snapshot operator settings for the whole tick. R1 BLOCKER #2
  // contract from sibling probes.
  const probeSettings = await resolveOperatorSettingsForProbe(
    pool,
    'learner-reminders',
  )
  const emailEnabled =
    probeSettings.LEARNER_REMINDERS_EMAIL_ENABLED.value === 1
  const windowMinutes = probeSettings.LEARNER_REMINDER_WINDOW_MINUTES.value
  const rateLimitPerTick =
    probeSettings.LEARNER_REMINDERS_RATE_LIMIT_PER_TICK.value

  // Telegram helper detection. Cached at module-load — re-resolving
  // here on every tick is cheap (the resolver short-circuits after
  // the first call).
  const tgHelper = await resolveTelegramHelper()
  const telegramHelperShipped = tgHelper !== null
  // Telegram is gated by ALL of:
  //   - helper shipped on `main` (BCS-DEF-1-TG)
  //   - operator master switch LEARNER_REMINDERS_TELEGRAM_ENABLED=1
  //     (BCS-DEF-4-TG, default 0)
  //   - TELEGRAM_BOT_TOKEN env present (pre-flight gate, see below)
  //   - per-user accounts.learner_telegram_enabled = true
  //   - per-user accounts.learner_telegram_chat_id IS NOT NULL
  const telegramMasterSwitch =
    probeSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value === 1
  // BCS-DEF-4-TG (2026-05-20) — config-missing burn prevention. When
  // master switch is ON but TELEGRAM_BOT_TOKEN env is empty, the
  // helper would return terminal `telegram_missing_token` on every
  // attempted send, burning the (slot_id, channel='telegram') rows
  // until manual cleanup. Pre-flight check: drop the channel-active
  // bit so we don't enqueue Telegram rows in this state. The
  // config_missing probe_runs row records the diagnosis.
  const telegramTokenPresent = (process.env.TELEGRAM_BOT_TOKEN?.trim() || '') !== ''
  const telegramChannelActive =
    telegramHelperShipped && telegramMasterSwitch && telegramTokenPresent

  // BCS-DEF-4-PUSH (2026-06-06) — pre-flight gate for Web Push channel.
  // Active iff master switch ON AND VAPID env triple present. Either
  // missing → push branch skipped entirely (no (slot,'push') rows written;
  // idempotency slot stays open for the next tick once misconfig clears).
  const pushMasterSwitch =
    probeSettings.LEARNER_REMINDERS_PUSH_ENABLED?.value === 1
  const vapidPublicKey = (process.env.PUSH_VAPID_PUBLIC_KEY?.trim() || '')
  const vapidPrivateKey = (process.env.PUSH_VAPID_PRIVATE_KEY?.trim() || '')
  const vapidSubject = (process.env.PUSH_VAPID_SUBJECT?.trim() || '')
  const vapidKeysPresent =
    vapidPublicKey !== '' && vapidPrivateKey !== '' && vapidSubject !== ''
  const pushChannelActive = pushMasterSwitch && vapidKeysPresent

  const capturedThresholds = {
    LEARNER_REMINDERS_EMAIL_ENABLED:
      probeSettings.LEARNER_REMINDERS_EMAIL_ENABLED.value,
    LEARNER_REMINDER_WINDOW_MINUTES: windowMinutes,
    LEARNER_REMINDERS_RATE_LIMIT_PER_TICK: rateLimitPerTick,
    LEARNER_REMINDERS_TELEGRAM_ENABLED:
      probeSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value ?? 0,
    LEARNER_REMINDERS_PUSH_ENABLED:
      probeSettings.LEARNER_REMINDERS_PUSH_ENABLED?.value ?? 0,
  }
  const capturedThresholdsSource = {
    LEARNER_REMINDERS_EMAIL_ENABLED:
      probeSettings.LEARNER_REMINDERS_EMAIL_ENABLED.source,
    LEARNER_REMINDER_WINDOW_MINUTES:
      probeSettings.LEARNER_REMINDER_WINDOW_MINUTES.source,
    LEARNER_REMINDERS_RATE_LIMIT_PER_TICK:
      probeSettings.LEARNER_REMINDERS_RATE_LIMIT_PER_TICK.source,
    LEARNER_REMINDERS_TELEGRAM_ENABLED:
      probeSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.source ?? 'default',
    LEARNER_REMINDERS_PUSH_ENABLED:
      probeSettings.LEARNER_REMINDERS_PUSH_ENABLED?.source ?? 'default',
  }

  // BCS-DEF-4-TG (2026-05-20) — emit config_missing diagnostic row
  // when master switch is on but bot token env is unset. Helps the
  // operator notice the env-file gap from the alerts page (the
  // probe_runs.verdict_kind='config_missing' row is queryable by
  // admin).
  if (telegramMasterSwitch && telegramHelperShipped && !telegramTokenPresent) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAME,
      verdictKind: VERDICT_KINDS.CONFIG_MISSING,
      recipientKind: RECIPIENT_KINDS.TELEGRAM,
      errorMessage: 'telegram_bot_token_unset',
      stats: { thresholds: capturedThresholds, thresholds_source: capturedThresholdsSource },
    })
    logJson(
      'warn',
      'telegram master switch on but TELEGRAM_BOT_TOKEN unset — channel inactive',
    )
  }

  // All channels off → early-exit with a single audit row.
  if (!emailEnabled && !telegramChannelActive && !pushChannelActive) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAME,
      verdictKind: VERDICT_KINDS.CHANNEL_DISABLED_BY_OPERATOR,
      recipientKind: RECIPIENT_KINDS.EMAIL,
      stats: {
        thresholds: capturedThresholds,
        thresholds_source: capturedThresholdsSource,
        telegram_helper_shipped: telegramHelperShipped,
        vapid_keys_present: vapidKeysPresent,
      },
    })
    logJson('info', 'all channels disabled, exiting tick early')
    return
  }

  // Tick-level send-budget. Counts email + telegram + push together.
  // One (slot, channel) row consumes one budget unit, regardless of
  // the push fan-out factor (per-account device count ≤ MAX_ACTIVE_PUSH
  // = 10). Rationale: rate-limit guards operator-side mistake, not
  // per-device cost (round-7 BLOCKER 2 unification).
  let sendBudget = rateLimitPerTick

  const stats = {
    selected_due_email: 0,
    selected_due_telegram: 0,
    selected_due_push: 0,
    sent_email: 0,
    sent_telegram: 0,
    sent_push: 0,
    skipped_slot_no_longer_booked: 0,
    skipped_email_missing: 0,
    skipped_past_send_by: 0,
    skipped_send_failed: 0,
    skipped_no_telegram_binding: 0,
    skipped_telegram_helper_not_shipped: 0,
    skipped_no_push_subscription: 0,
    sends_overflowed_rate_limit: 0,
    push_subs_auto_unsubscribed: 0,
    thresholds: capturedThresholds,
    thresholds_source: capturedThresholdsSource,
    telegram_helper_shipped: telegramHelperShipped,
    vapid_keys_present: vapidKeysPresent,
  }

  // ---- Email channel ----
  if (emailEnabled) {
    const dueEmail = await readDueSlots(pool, {
      windowMinutes,
      rateLimitPerTick,
      channel: 'email',
    })
    stats.selected_due_email = dueEmail.length

    for (const row of dueEmail) {
      // Step 5b: atomic claim.
      const claimRes = await pool.query(
        `
        INSERT INTO learner_reminder_dispatches
          (slot_id, account_id, channel, window_minutes_at_dispatch, status)
        VALUES ($1::uuid, $2::uuid, 'email', $3::int, 'claimed')
        ON CONFLICT (slot_id, channel) DO NOTHING
        RETURNING id
        `,
        [row.slotId, row.learnerAccountId, windowMinutes],
      )
      if (claimRes.rows.length === 0) {
        // Another tick won the race; do not count this row.
        continue
      }
      const rowId = String(claimRes.rows[0].id)

      // Step 5c: re-fetch + gate. Skip-at-gate finalizations do not
      // consume sendBudget.
      const gate = await reFetchAndGate(pool, row.slotId, windowMinutes)
      if ('skipped' in gate) {
        await finalizeSkipped(pool, rowId, gate.skipped, null)
        if (gate.skipped === 'slot_no_longer_booked') {
          stats.skipped_slot_no_longer_booked += 1
        } else if (gate.skipped === 'email_missing') {
          stats.skipped_email_missing += 1
        } else if (gate.skipped === 'past_send_by') {
          stats.skipped_past_send_by += 1
        }
        continue
      }

      // Step 6c: provider budget. If we'd spend our last send-credit
      // here, finalize as overflow.
      if (sendBudget <= 0) {
        await finalizeSkipped(pool, rowId, 'past_send_by', null)
        stats.skipped_past_send_by += 1
        stats.sends_overflowed_rate_limit += 1
        continue
      }
      sendBudget -= 1

      // Step 5d: send.
      const { subject, text } = renderLearnerLessonReminderText({
        windowMinutes,
        teacherDisplayName: row.teacherDisplayName,
        zoomUrl: row.zoomUrl,
        startAt: row.startAt,
        durationMinutes: row.durationMinutes,
        learnerTimezone: row.learnerTimezone,
        learnerDisplayName: row.learnerDisplayName,
        cabinetUrl: `${SITE_URL}/cabinet`,
      })
      const result = await sendOneEmail({
        to: gate.learnerEmail,
        subject,
        text,
      })
      const classified = classifyEmailResult(result)
      if (classified.kind === 'sent') {
        await finalizeSent(pool, rowId, {
          channel: 'email',
          providerId: classified.resendId,
        })
        stats.sent_email += 1
      } else {
        await finalizeSkipped(pool, rowId, classified.reason, classified.detail)
        stats.skipped_send_failed += 1
      }
    }
  }

  // ---- Telegram channel ----
  if (telegramChannelActive) {
    const dueTg = await readDueSlots(pool, {
      windowMinutes,
      rateLimitPerTick,
      channel: 'telegram',
    })
    stats.selected_due_telegram = dueTg.length

    for (const row of dueTg) {
      // Per-row TG opt-in gate (cheap pre-check before we claim a
      // row — opting out leaves no dispatch trail, which matches
      // the email-master-switch-off behaviour for symmetry).
      if (!row.learnerTelegramEnabled || !row.learnerTelegramChatId) {
        // No claim row written; user is not opted-in. Skip silently.
        continue
      }

      const claimRes = await pool.query(
        `
        INSERT INTO learner_reminder_dispatches
          (slot_id, account_id, channel, window_minutes_at_dispatch, status)
        VALUES ($1::uuid, $2::uuid, 'telegram', $3::int, 'claimed')
        ON CONFLICT (slot_id, channel) DO NOTHING
        RETURNING id
        `,
        [row.slotId, row.learnerAccountId, windowMinutes],
      )
      if (claimRes.rows.length === 0) continue
      const rowId = String(claimRes.rows[0].id)

      const gate = await reFetchAndGate(pool, row.slotId, windowMinutes)
      if ('skipped' in gate) {
        // For Telegram, an `email_missing` gate is irrelevant — we
        // don't need the email column to send Telegram. Treat it
        // as slot_no_longer_booked when the account is purged
        // (we already filter that out above; this branch only fires
        // for true cancel + past_send_by).
        const reason =
          gate.skipped === 'email_missing'
            ? 'slot_no_longer_booked'
            : gate.skipped
        await finalizeSkipped(pool, rowId, reason, null)
        if (reason === 'slot_no_longer_booked') {
          stats.skipped_slot_no_longer_booked += 1
        } else if (reason === 'past_send_by') {
          stats.skipped_past_send_by += 1
        }
        continue
      }

      if (sendBudget <= 0) {
        await finalizeSkipped(pool, rowId, 'past_send_by', null)
        stats.skipped_past_send_by += 1
        stats.sends_overflowed_rate_limit += 1
        continue
      }
      sendBudget -= 1

      const { text } = renderLearnerLessonReminderText({
        windowMinutes,
        teacherDisplayName: row.teacherDisplayName,
        zoomUrl: row.zoomUrl,
        startAt: row.startAt,
        durationMinutes: row.durationMinutes,
        learnerTimezone: row.learnerTimezone,
        learnerDisplayName: row.learnerDisplayName,
        cabinetUrl: `${SITE_URL}/cabinet`,
      })
      try {
        const tgResult = await tgHelper.sendTelegramMessage({
          botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || '',
          chatId: row.learnerTelegramChatId,
          text,
          retryMax: 1,
        })
        if (tgResult.ok) {
          await finalizeSent(pool, rowId, {
            channel: 'telegram',
            providerId: tgResult.messageId
              ? String(tgResult.messageId)
              : null,
          })
          stats.sent_telegram += 1
        } else {
          await finalizeSkipped(
            pool,
            rowId,
            'send_failed',
            truncate(tgResult.detail ?? tgResult.error ?? 'unknown'),
          )
          stats.skipped_send_failed += 1
        }
      } catch (err) {
        await finalizeSkipped(
          pool,
          rowId,
          'send_failed',
          truncate(err instanceof Error ? err.message : String(err)),
        )
        stats.skipped_send_failed += 1
      }
    }
  } else {
    // Helper not shipped. Per the plan, only WRITE skipped rows for
    // learners who are actively opted-in (otherwise we'd flood the
    // dispatch table with dead rows for every booked slot every
    // minute). One row per opted-in learner gives the operator
    // visibility into "TG is dormant for these users".
    const dueTg = await readDueSlots(pool, {
      windowMinutes,
      rateLimitPerTick,
      channel: 'telegram',
    })
    for (const row of dueTg) {
      if (!row.learnerTelegramEnabled || !row.learnerTelegramChatId) {
        continue
      }
      const claimRes = await pool.query(
        `
        INSERT INTO learner_reminder_dispatches
          (slot_id, account_id, channel, window_minutes_at_dispatch, status)
        VALUES ($1::uuid, $2::uuid, 'telegram', $3::int, 'claimed')
        ON CONFLICT (slot_id, channel) DO NOTHING
        RETURNING id
        `,
        [row.slotId, row.learnerAccountId, windowMinutes],
      )
      if (claimRes.rows.length === 0) continue
      const rowId = String(claimRes.rows[0].id)
      await finalizeSkipped(
        pool,
        rowId,
        'telegram_helper_not_shipped',
        null,
      )
      stats.skipped_telegram_helper_not_shipped += 1
    }
  }

  // ---- Push channel (BCS-DEF-4-PUSH) ----
  if (pushChannelActive) {
    const duePush = await readDueSlots(pool, {
      windowMinutes,
      rateLimitPerTick,
      channel: 'push',
    })
    stats.selected_due_push = duePush.length

    for (const row of duePush) {
      // 1. CLAIM FIRST.
      const claimRes = await pool.query(
        `
        INSERT INTO learner_reminder_dispatches
          (slot_id, account_id, channel, window_minutes_at_dispatch, status)
        VALUES ($1::uuid, $2::uuid, 'push', $3::int, 'claimed')
        ON CONFLICT (slot_id, channel) DO NOTHING
        RETURNING id
        `,
        [row.slotId, row.learnerAccountId, windowMinutes],
      )
      if (claimRes.rows.length === 0) continue
      const rowId = String(claimRes.rows[0].id)

      // 2. Send-time recheck (skip-at-gate does NOT consume budget).
      const gate = await reFetchAndGate(pool, row.slotId, windowMinutes)
      if ('skipped' in gate) {
        // For Push, an `email_missing` gate is irrelevant — push doesn't
        // require email. Treat it the same way the telegram branch does:
        // collapse to slot_no_longer_booked since email is anonymised on
        // account purge.
        const reason =
          gate.skipped === 'email_missing'
            ? 'slot_no_longer_booked'
            : gate.skipped
        await finalizeSkipped(pool, rowId, reason, null)
        if (reason === 'slot_no_longer_booked') {
          stats.skipped_slot_no_longer_booked += 1
        } else if (reason === 'past_send_by') {
          stats.skipped_past_send_by += 1
        }
        continue
      }

      // 3. Budget check.
      if (sendBudget <= 0) {
        await finalizeSkipped(pool, rowId, 'past_send_by', null)
        stats.skipped_past_send_by += 1
        stats.sends_overflowed_rate_limit += 1
        continue
      }
      sendBudget -= 1

      // 4. SELECT active subs.
      const subsRes = await pool.query(
        `
        SELECT id, endpoint, p256dh_b64url, auth_b64url
          FROM learner_push_subscriptions
         WHERE account_id = $1::uuid AND unsubscribed_at IS NULL
         ORDER BY id ASC
        `,
        [row.learnerAccountId],
      )
      const subs = subsRes.rows
      if (subs.length === 0) {
        await finalizeSkipped(pool, rowId, 'no_push_subscription', null)
        stats.skipped_no_push_subscription += 1
        continue
      }

      // 5. Fan out to each subscription.
      const payload = renderLearnerPushPayload({
        windowMinutes,
        cabinetUrl: `${SITE_URL}/cabinet`,
      })
      let anyOk = false
      let lastFailure = null
      for (const sub of subs) {
        const res = await sendWebPush(
          {
            endpoint: String(sub.endpoint),
            p256dh_b64url: String(sub.p256dh_b64url),
            auth_b64url: String(sub.auth_b64url),
          },
          payload,
          process.env,
        )
        if (res.ok) {
          anyOk = true
          await pool.query(
            `UPDATE learner_push_subscriptions
                SET last_used_at = now(),
                    last_status_code = $2::int,
                    last_error = NULL,
                    updated_at = now()
              WHERE id = $1::bigint`,
            [String(sub.id), res.statusCode ?? null],
          )
        } else if (res.reason === 'endpoint_gone') {
          await pool.query(
            `UPDATE learner_push_subscriptions
                SET unsubscribed_at = now(),
                    last_status_code = $2::int,
                    last_error = $3::text,
                    updated_at = now()
              WHERE id = $1::bigint`,
            [String(sub.id), res.statusCode ?? null, truncate(res.error)],
          )
          stats.push_subs_auto_unsubscribed += 1
          // Emit audit row through dedicated pool.
          await recordPushSubscriptionUnsubscribedAuto({
            pool,
            accountId: row.learnerAccountId,
            endpoint: String(sub.endpoint),
            statusCode: res.statusCode ?? null,
            reason: 'endpoint_gone',
          })
          lastFailure = truncate(`endpoint_gone:${res.statusCode}`)
        } else {
          await pool.query(
            `UPDATE learner_push_subscriptions
                SET last_status_code = $2::int,
                    last_error = $3::text,
                    updated_at = now()
              WHERE id = $1::bigint`,
            [String(sub.id), res.statusCode ?? null, truncate(res.error)],
          )
          lastFailure = truncate(res.error ?? `send_failed:${res.statusCode}`)
        }
      }

      // 6. Final row outcome.
      if (anyOk) {
        await finalizeSent(pool, rowId, { channel: 'push', providerId: null })
        stats.sent_push += 1
      } else {
        await finalizeSkipped(pool, rowId, 'send_failed', lastFailure)
        stats.skipped_send_failed += 1
      }
    }
  }

  // Aggregate observability row.
  await recordProbeRun(pool, {
    probeName: PROBE_NAME,
    verdictKind: VERDICT_KINDS.OK,
    recipientKind: RECIPIENT_KINDS.EMAIL,
    stats,
  })
  logJson('info', 'tick complete', { stats })
}

// --- Finalize helpers ------------------------------------------------

async function finalizeSent(pool, rowId, { channel, providerId }) {
  if (channel === 'email') {
    await pool.query(
      `
      UPDATE learner_reminder_dispatches
         SET status         = 'sent',
             sent_at        = now(),
             resend_email_id = $2::text,
             skipped_reason = NULL,
             last_error     = NULL,
             updated_at     = now()
       WHERE id = $1::bigint
      `,
      [rowId, providerId],
    )
  } else if (channel === 'telegram') {
    await pool.query(
      `
      UPDATE learner_reminder_dispatches
         SET status              = 'sent',
             sent_at             = now(),
             telegram_message_id = $2::text,
             skipped_reason      = NULL,
             last_error          = NULL,
             updated_at          = now()
       WHERE id = $1::bigint
      `,
      [rowId, providerId],
    )
  } else {
    // push: no provider-id column (Web Push has no aggregate message id).
    await pool.query(
      `
      UPDATE learner_reminder_dispatches
         SET status         = 'sent',
             sent_at        = now(),
             skipped_reason = NULL,
             last_error     = NULL,
             updated_at     = now()
       WHERE id = $1::bigint
      `,
      [rowId],
    )
  }
}

async function finalizeSkipped(pool, rowId, reason, lastError) {
  await pool.query(
    `
    UPDATE learner_reminder_dispatches
       SET status         = 'skipped',
           skipped_reason = $2::text,
           sent_at        = NULL,
           last_error     = $3::text,
           updated_at     = now()
     WHERE id = $1::bigint
    `,
    [rowId, reason, lastError ?? null],
  )
}

// --- Main ------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: resolveSslConfig(process.env.DATABASE_URL),
  })
  try {
    await tick(pool)
  } catch (err) {
    await recordProbeRun(pool, {
      probeName: PROBE_NAME,
      verdictKind: VERDICT_KINDS.ERROR,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && process.argv[1].endsWith('learner-reminder-dispatch.mjs'))

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'learner-reminder-dispatch crashed', {
      message: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  })
}

// Named exports for unit tests.
export { finalizeSent, finalizeSkipped, reFetchAndGate, tick }
