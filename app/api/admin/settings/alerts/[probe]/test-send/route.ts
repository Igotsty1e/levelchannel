import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { isUndefinedTableError } from '@/lib/db/errors'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import { isProbeName } from '@/lib/admin/probe-status'

// ALERTS-OBS (2026-05-16) — POST /api/admin/settings/alerts/[probe]/test-send.
// Plan: docs/plans/alerts-obs.md §4.6.
//
// Sends a hardcoded "[LevelChannel] TEST — <probe> dry-run" email
// via Resend so the operator can verify ALERT_EMAIL_TO + RESEND_API_KEY
// without waiting for a real incident.
//
// Records one probe_runs row with is_test=true + initiator_account_id
// + verdict_kind=test_send_succeeded|test_send_failed. The
// /admin/settings/alerts page's "last run" + "last alert" queries
// filter is_test=false so test-sends do NOT pollute observability.
//
// Migration-pending preflight: explicit `select 1 from probe_runs
// limit 0` BEFORE any Resend call. On Postgres error 42P01, returns
// 503 — closes round-3 BLOCKER #1 (preflight must run before any
// side-effect).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ probe: string }> }

// `isUndefinedTableError` lives in lib/db/errors — AUDIT-CODE-3
// (2026-05-17) extracted it from this file + lib/admin/probe-status.ts
// so the two stay aligned. Migration-pending preflight returns 503 on
// the same Postgres SQLSTATE 42P01 the admin page banner reads.

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:alerts:test-send:ip',
    5,
    60 * 60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { probe } = await params
  if (!isProbeName(probe)) {
    return NextResponse.json(
      { error: 'invalid_probe' },
      { status: 400, headers: NO_STORE },
    )
  }

  let rawBody: string
  let body: { confirmReason?: string } = {}
  try {
    rawBody = await request.text()
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const confirmReason =
    typeof body.confirmReason === 'string' && body.confirmReason.trim().length >= 3
      ? body.confirmReason.trim().slice(0, 512)
      : null
  if (!confirmReason) {
    return NextResponse.json(
      {
        error: 'reason_required',
        message: 'Опишите причину тестовой отправки (≥3 символа).',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  // AUDIT-CODE-2 (2026-05-17) — move env-existence + migration-pending
  // preflights OUTSIDE withIdempotency so transient 422/503 responses
  // do NOT get cached. Before this fix, a missing ALERT_EMAIL_TO
  // produced a 422 row in idempotency_records keyed on the request
  // hash; once the operator set the env var and retried with the same
  // Idempotency-Key, the cached 422 replayed and the real Resend send
  // never happened. Now the env/table checks are pre-cache; only the
  // actual Resend call + its outcome (which IS a real side effect we
  // want to dedupe) sits inside withIdempotency.
  const pool = getDbPool()

  // Migration-pending preflight (round-3 BLOCKER #1 closure stays
  // in force; just moved outside the idempotency wrapper).
  try {
    await pool.query(`select 1 from probe_runs limit 0`)
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return NextResponse.json(
        {
          error: 'migration_pending',
          message:
            'БД миграция 0053 не применена. Запустите npm run migrate:up на VPS.',
        },
        { status: 503, headers: NO_STORE },
      )
    }
    throw err
  }

  // BCS-DEF-1 wave-paranoia round-1 BLOCKER#1 closure (2026-05-19):
  // verify the probe_runs.probe_name CHECK actually enumerates the
  // requested probe name BEFORE we trigger a Resend send. Without
  // this check, the deploy-before-migrate window for a new probe
  // (e.g. BCS-DEF-1 Phase 1 added 'conflict-unresolved' to the CHECK
  // via migration 0058; pre-migration the route would Resend-send
  // an email, then crash with SQLSTATE 23514 on the probe_runs
  // INSERT — leaving the operator with a sent email but a 500
  // response and no audit row).
  //
  // Read pg_get_constraintdef and look for the probe value verbatim.
  // If absent, return 503 migration_pending mirroring the
  // probe_runs-missing branch above. No false-negative concern: the
  // CHECK is enumerated text in the constraint definition.
  try {
    const checkDefResult = await pool.query<{ check_def: string | null }>(
      `select pg_get_constraintdef(c.oid) as check_def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
        where t.relname = 'probe_runs'
          and c.conname = 'probe_runs_probe_name_check'`,
    )
    const checkDef = checkDefResult.rows[0]?.check_def ?? ''
    if (!checkDef.includes(`'${probe}'`)) {
      return NextResponse.json(
        {
          error: 'migration_pending',
          message: `Миграция CHECK constraint для probe='${probe}' ещё не применена. Запустите npm run migrate:up на VPS.`,
        },
        { status: 503, headers: NO_STORE },
      )
    }
  } catch (err) {
    // pg_constraint lookup itself failed — best-effort; fall through
    // and let the original INSERT handle the error. Don't return 500
    // here because the probe_runs preflight above already proved the
    // pool is up.
    // eslint-disable-next-line no-console
    console.warn('[test-send] CHECK-extension preflight failed; proceeding', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  const recipient = process.env.ALERT_EMAIL_TO?.trim() || ''
  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const emailFrom =
    process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'

  const operatorId = auth.account.id
  const initiatorStats = { reason: confirmReason, probe }

  if (!recipient || !apiKey) {
    // Write a probe_runs row so the operator's admin page reflects
    // the attempted test-send + its config-missing diagnosis. Fresh
    // fingerprint per attempt so double-click during the env-missing
    // window produces two distinct audit rows (acceptable — they're
    // labeled is_test=true and excluded from "last run" / "last alert"
    // queries).
    const failFingerprint = `test-${operatorId}-${Date.now()}-cfg`
    await pool.query(
      `insert into probe_runs (
         probe_name, verdict_kind, alert_sent,
         recipient_email, fingerprint, stats, error_message,
         is_test, initiator_account_id
       ) values ($1, 'test_send_failed', false, $2, $3, $4::jsonb, $5, true, $6::uuid)`,
      [
        probe,
        recipient || null,
        failFingerprint,
        JSON.stringify(initiatorStats),
        !recipient ? 'missing_alert_email_to' : 'missing_resend_api_key',
        operatorId,
      ],
    )
    return NextResponse.json(
      {
        error: !recipient ? 'missing_alert_email_to' : 'missing_resend_api_key',
        message:
          !recipient
            ? 'ALERT_EMAIL_TO не задан в env на VPS.'
            : 'RESEND_API_KEY не задан в env на VPS.',
      },
      { status: 422, headers: NO_STORE },
    )
  }

  // withIdempotency below deduplicates SEQUENTIAL same-key replays
  // (operator's tab retries, network-flap auto-retry with reused
  // Idempotency-Key). CONCURRENT same-key fire MAY still send two
  // emails — see contract on lib/security/idempotency.ts. Resend
  // is NOT idempotent (each call is a distinct send), so concurrent
  // double-fire produces two operator inbox entries. Acceptable
  // because the admin UI generates a fresh UUID Idempotency-Key per
  // click; same-key concurrent requires an explicitly racing client.
  return withIdempotency(
    request,
    `admin:alerts:test-send:${probe}:${auth.account.id}`,
    rawBody,
    async () => {
      const fingerprint = `test-${operatorId}-${Date.now()}`

      // Resend SDK import is dynamic so the route doesn't pull the
      // dependency at module load (mirrors the probe scripts'
      // pattern — only loaded when actually sending).
      const { Resend } = await import('resend')
      const resend = new Resend(apiKey)
      const subject = `[LevelChannel] TEST — ${probe} dry-run`
      const text = [
        `Test alert for probe: ${probe}`,
        '',
        `Triggered by operator: ${auth.account.email}`,
        `Reason: ${confirmReason}`,
        `Timestamp: ${new Date().toISOString()}`,
        `Test fingerprint: ${fingerprint}`,
        '',
        'This is a manually-triggered dry-run from',
        '/admin/settings/alerts. No real incident.',
      ].join('\n')

      let sentEmailId: string | null = null
      let sendError: string | null = null
      try {
        const result = await resend.emails.send({
          from: emailFrom,
          to: [recipient],
          subject,
          text,
        })
        if (result.error) {
          sendError = result.error.message || 'resend_send_failed'
        } else {
          sentEmailId = result.data?.id ?? null
        }
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err)
      }

      await pool.query(
        `insert into probe_runs (
           probe_name, verdict_kind, alert_sent,
           recipient_email, alert_email_id, fingerprint,
           stats, error_message,
           is_test, initiator_account_id
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, $9::uuid)`,
        [
          probe,
          sendError ? 'test_send_failed' : 'test_send_succeeded',
          sendError ? false : true,
          recipient,
          sentEmailId,
          fingerprint,
          JSON.stringify(initiatorStats),
          sendError,
          operatorId,
        ],
      )

      if (sendError) {
        return {
          status: 502,
          body: {
            error: 'send_failed',
            message: `Resend вернул ошибку: ${sendError}`,
          },
        }
      }

      return {
        status: 200,
        body: {
          ok: true,
          emailId: sentEmailId,
          sentAt: new Date().toISOString(),
          fingerprint,
        },
      }
    },
  )
}

