// GET /api/learner/calendar.ics?account=<uuid>&token=<expiresAtMs.hmacHex>
//
// 2026-06-17 — public ICS feed для подписки в Google Calendar /
// Apple Calendar. Token: signLearnerIcsToken(accountId, version, expires)
// → HMAC-проверка через timingSafeEqual.
//
// 2026-06-18 codex-audit BLOCKER §5.1 fix:
// - Token включает expiresAtMs + per-account version (accounts.ics_token_version)
// - Bump version → старые токены invalid (revoke без ротации секрета)
// - TTL 90 дней default; calendar apps re-sync прозрачно
// - Из ICS body убран teacher email (PII не утекает даже при валидном
//   токене)

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  buildLearnerIcs,
  verifyLearnerIcsToken,
} from '@/lib/calendar/learner-ics'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  // Rate-limit IP (calendar apps poll каждые несколько минут).
  const rl = await enforceRateLimit(
    request,
    'learner:calendar-ics:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const url = new URL(request.url)
  const accountId = url.searchParams.get('account') ?? ''
  const token = url.searchParams.get('token') ?? ''

  if (!UUID_PATTERN.test(accountId)) {
    return NextResponse.json(
      { error: 'bad_account' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Читаем текущую версию токена из БД. Если accountId не существует
  // — single 403 (no enumeration).
  const pool = getDbPool()
  const versionRow = await pool.query<{ ics_token_version: number }>(
    `select ics_token_version from accounts where id = $1`,
    [accountId],
  )
  const version = versionRow.rows[0]?.ics_token_version
  if (typeof version !== 'number') {
    return NextResponse.json(
      { error: 'bad_token' },
      { status: 403, headers: NO_STORE },
    )
  }
  if (!verifyLearnerIcsToken(accountId, version, token)) {
    return NextResponse.json(
      { error: 'bad_token' },
      { status: 403, headers: NO_STORE },
    )
  }

  // Тянем 90 дней назад + ВСЁ будущее. ICS feed обычно держит
  // последние ~3 месяца + предстоящие; этого достаточно для G/A Calendar.
  // 2026-06-18 — убрали JOIN на accounts (teacher_email) — PII удалён
  // из feed body.
  const fromIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const r = await pool.query<{
    id: string
    start_at: string
    duration_minutes: number
    status: string
    tariff_title_ru: string | null
  }>(
    `select s.id,
            s.start_at::text as start_at,
            s.duration_minutes,
            s.status,
            t.title_ru as tariff_title_ru
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
        and s.start_at >= $2
      order by s.start_at asc
      limit 500`,
    [accountId, fromIso],
  )
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://levelchannel.ru'
  const body = buildLearnerIcs(
    r.rows.map((row) => ({
      id: String(row.id),
      startAtIso: row.start_at,
      durationMinutes: row.duration_minutes,
      status: String(row.status),
      tariffTitleRu: row.tariff_title_ru ?? null,
    })),
    siteUrl,
  )

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
