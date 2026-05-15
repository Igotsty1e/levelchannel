import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
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

  const teacherId = session.account.assignedTeacherId
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
    // Resolve teacher email → display name. Tiny lookup; reusing
    // getAccountByEmail keeps us out of cross-cabinet queries.
    const pool = await import('@/lib/db/pool').then((m) => m.getDbPool())
    const r = await pool.query(
      `select coalesce(p.display_name, a.email) as name
         from accounts a
         left join account_profiles p on p.account_id = a.id
        where a.id = $1`,
      [teacherId],
    )
    teacherDisplayName = r.rows[0]?.name ? String(r.rows[0].name) : null
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
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              margin: 0,
              marginBottom: 12,
              color: 'var(--text-strong, #1a1a2e)',
            }}
          >
            Урок английского
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
            <div>🕒 50 мин</div>
            <div>📹 Ссылку на встречу пришлём после подтверждения.</div>
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
            <MonthDayPicker tz={tz} />
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
