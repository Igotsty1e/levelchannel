import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getActiveTeacherForLearner } from '@/lib/auth/teacher-scope'
import { TIMEZONE_OPTIONS, safeTimezone } from '@/lib/auth/timezones'

import { MonthDayPicker } from './month-day-picker'

// BCS-B.frontend — Calendly screen 1.
//
// Lists the days in a month grid that have ≥1 OPEN slot for the
// learner's assigned teacher. Tapping a day routes to
// /cabinet/book/<ymd>. Server-side: render the static frame (header,
// teacher meta) + the client-side month picker that fetches
// /api/slots/booking-days.
//
// Auth gate identical to /cabinet — direct session lookup, SSR
// redirect on missing/expired.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Записаться — LevelChannel',
}

export default async function BookPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  if (!session.account.emailVerifiedAt) {
    // Same surface as cabinet — verify-email banner is the right home
    // before they can book.
    redirect('/cabinet')
  }

  // SAAS-PIVOT Day 2 (2026-05-22) — n:m teacher context (plan §2.5).
  // Single-link learner: `resolved.teacherId` directly. Multi-link
  // learner: fall back to the first-linked teacher (back-compat alias
  // semantics) so the cabinet flow remains functional v0. Epic 7
  // adds the full teacher chooser. Zero-link → null + the existing
  // «учитель не назначен» hint.
  //
  // The selected teacher id is forwarded as ?teacher=<id> all the way
  // through MonthDayPicker → /api/slots/booking-days → time-list →
  // /api/slots/booking-times → confirm screen → /api/slots/[id]/book,
  // so multi-link learners never trip the needs_teacher_picker error
  // path during the MVP single-teacher cabinet flow.
  const resolved = await getActiveTeacherForLearner(session.account.id)
  const teacherId =
    resolved.teacherId ?? session.account.assignedTeacherIds[0] ?? null
  const profile = await getAccountProfile(session.account.id)
  // BUG fix 2026-05-15 — legacy rows may carry a non-IANA value like
  // 'Moscow' which then leaks to /api/slots/booking-days as `tz=Moscow`
  // and triggers "tz must be a valid IANA timezone" on the API side.
  // safeTimezone() clamps any non-allowlisted value to Europe/Moscow.
  const tz = safeTimezone(profile?.timezone)
  const tzLabel =
    TIMEZONE_OPTIONS.find((t) => t.id === tz)?.label ?? tz

  let teacherDisplayName: string | null = null
  if (teacherId) {
    // Resolve teacher account id → display name. Tiny direct query;
    // keeps us out of cross-cabinet queries.
    // TASK-5 (mig 0095) — prefer first/last name when present, fall
    // back to display_name, then email.
    const pool = await import('@/lib/db/pool').then((m) => m.getDbPool())
    const { formatProfileNameForRender } = await import(
      '@/lib/auth/profile-name'
    )
    const r = await pool.query(
      `select a.email, p.display_name, p.first_name, p.last_name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [teacherId],
    )
    const row = r.rows[0]
    teacherDisplayName = row
      ? formatProfileNameForRender({
          firstName: row.first_name ? String(row.first_name) : null,
          lastName: row.last_name ? String(row.last_name) : null,
          displayName: row.display_name ? String(row.display_name) : null,
          fallbackEmail: row.email ? String(row.email) : '',
        })
      : null
  }

  return (
    <AuthShell>
      <div style={{ width: '100%', maxWidth: 520, padding: '24px 16px' }}>
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          ← В кабинет
        </Link>

        {/* Calendly-style header. */}
        <div style={{ marginTop: 16, marginBottom: 24 }}>
          {teacherDisplayName ? (
            <p
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                margin: 0,
                marginBottom: 4,
              }}
            >
              {teacherDisplayName}
            </p>
          ) : null}
          {/*
            Bug #3 fix (2026-06-02): the original h1 + duration line
            were hardcoded placeholders from the BCS-B.frontend wave —
            neither value was sourced from any tariff/slot row. Real
            per-slot title + duration come from the tariff snapshot
            on the slot, surfaced on screen 2 (`/cabinet/book/[ymd]`)
            where the learner sees specific slots. Screen 1 just sets
            up the day picker — it has no tariff context yet
            (different days may carry different tariffs), so we
            render a neutral product label here.
          */}
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              margin: 0,
              marginBottom: 12,
              color: 'var(--text-strong, #1a1a2e)',
            }}
          >
            Запись на занятие
          </h1>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              color: 'var(--secondary)',
            }}
          >
            <div>📹 Ссылку на встречу пришлёт учитель — обычно за день до занятия.</div>
          </div>
        </div>

        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--border)',
            margin: '0 0 16px 0',
          }}
        />

        {!teacherId ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            Учитель пока не назначен. Напишите оператору, чтобы привязал
            вас — после этого здесь появится расписание.
          </p>
        ) : (
          <>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                textAlign: 'center',
                margin: '8px 0 16px 0',
              }}
            >
              Выберите день
            </h2>
            <MonthDayPicker tz={tz} teacherAccountId={teacherId} />
            <p
              style={{
                fontSize: 12,
                color: 'var(--secondary)',
                marginTop: 16,
                textAlign: 'center',
              }}
            >
              Время отображается в часовом поясе {tzLabel}.
            </p>
          </>
        )}
      </div>
    </AuthShell>
  )
}
