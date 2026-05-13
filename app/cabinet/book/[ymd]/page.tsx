import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { isValidYmd } from '@/lib/scheduling/slots'

import { TimeList } from './time-list'

// BCS-B.frontend — Calendly screen 2.
// Lists the OPEN slot times for the picked day; tapping a time routes
// to /cabinet/book/<ymd>/<slotId>.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Выберите время — LevelChannel',
}

type RouteParams = { params: Promise<{ ymd: string }> }

const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const WEEKDAY_NAMES = [
  'воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота',
]

export default async function BookDayPage({ params }: RouteParams) {
  const { ymd } = await params

  if (!isValidYmd(ymd)) redirect('/cabinet/book')

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')
  if (!session.account.emailVerifiedAt) redirect('/cabinet')

  const profile = await getAccountProfile(session.account.id)
  const tz = profile?.timezone ?? 'Europe/Moscow'

  // Pretty header: localize the picked day. Date constructor treats
  // `YYYY-MM-DD` as UTC midnight; we want a human readable label in
  // the learner's tz.
  const date = new Date(`${ymd}T00:00:00`)
  const weekday = WEEKDAY_NAMES[date.getDay()]
  const month = MONTH_NAMES[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()

  return (
    <AuthShell>
      <div style={{ width: '100%', maxWidth: 520, padding: '24px 16px' }}>
        <Link
          href="/cabinet/book"
          aria-label="Назад к выбору дня"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--accent, #3b82f6)',
            color: 'var(--accent, #3b82f6)',
            textDecoration: 'none',
          }}
        >
          ←
        </Link>

        <div style={{ marginTop: 16, marginBottom: 16, textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              margin: 0,
              textTransform: 'capitalize',
            }}
          >
            {weekday}
          </h1>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: 15,
              color: 'var(--secondary)',
            }}
          >
            {day} {month} {year}
          </p>
          <p
            style={{
              margin: '12px 0 0 0',
              fontSize: 13,
              color: 'var(--secondary)',
            }}
          >
            🌐 {tz}
          </p>
        </div>

        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--border)',
            margin: '0 0 16px 0',
          }}
        />

        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            textAlign: 'center',
            margin: '8px 0',
          }}
        >
          Выберите время
        </h2>
        <p
          style={{
            fontSize: 13,
            color: 'var(--secondary)',
            textAlign: 'center',
            marginTop: 0,
            marginBottom: 16,
          }}
        >
          Длительность: 50 мин
        </p>

        <TimeList ymd={ymd} tz={tz} />
      </div>
    </AuthShell>
  )
}
