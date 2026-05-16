import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
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

const ERR_UNDEFINED_TABLE = '42P01'

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === ERR_UNDEFINED_TABLE
  )
}

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

  return withIdempotency(
    request,
    `admin:alerts:test-send:${probe}:${auth.account.id}`,
    rawBody,
    async () => {
      const pool = getDbPool()

      // Migration-pending preflight (round-3 BLOCKER #1 closure).
      // MUST run before any Resend call so an unmigrated DB doesn't
      // get a side-effect email + 200 response.
      try {
        await pool.query(`select 1 from probe_runs limit 0`)
      } catch (err) {
        if (isUndefinedTableError(err)) {
          return {
            status: 503,
            body: {
              error: 'migration_pending',
              message:
                'БД миграция 0053 не применена. Запустите npm run migrate:up на VPS.',
            },
          }
        }
        throw err
      }

      const recipient = process.env.ALERT_EMAIL_TO?.trim() || ''
      const apiKey = process.env.RESEND_API_KEY?.trim() || ''
      const emailFrom =
        process.env.EMAIL_FROM?.trim() || 'LevelChannel <noreply@example.com>'

      const operatorId = auth.account.id
      const fingerprint = `test-${operatorId}-${Date.now()}`
      const initiatorStats = { reason: confirmReason, probe }

      if (!recipient || !apiKey) {
        await pool.query(
          `insert into probe_runs (
             probe_name, verdict_kind, alert_sent,
             recipient_email, fingerprint, stats, error_message,
             is_test, initiator_account_id
           ) values ($1, 'test_send_failed', false, $2, $3, $4::jsonb, $5, true, $6::uuid)`,
          [
            probe,
            recipient || null,
            fingerprint,
            JSON.stringify(initiatorStats),
            !recipient ? 'missing_alert_email_to' : 'missing_resend_api_key',
            operatorId,
          ],
        )
        return {
          status: 422,
          body: {
            error: !recipient ? 'missing_alert_email_to' : 'missing_resend_api_key',
            message:
              !recipient
                ? 'ALERT_EMAIL_TO не задан в env на VPS.'
                : 'RESEND_API_KEY не задан в env на VPS.',
          },
        }
      }

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

