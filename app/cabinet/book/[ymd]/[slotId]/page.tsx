import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getSlotById, isValidYmd } from '@/lib/scheduling/slots'

import { ConfirmForm } from './confirm-form'

// BCS-B.frontend — Calendly screen 3.
// Confirm a specific slot, capture optional agenda comment, POST to
// /api/slots/<id>/book.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Подтверждение — LevelChannel',
}

type RouteParams = { params: Promise<{ ymd: string; slotId: string }> }

const MONTH_NAMES_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const WEEKDAY_NAMES = [
  'воскресенье', 'понедельник', 'вторник', 'среда',
  'четверг', 'пятница', 'суббота',
]

export default async function BookConfirmPage({ params }: RouteParams) {
  const { ymd, slotId } = await params

  if (!isValidYmd(ymd)) redirect('/cabinet/book')

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')
  if (!session.account.emailVerifiedAt) redirect('/cabinet')

  const slot = await getSlotById(slotId)
  if (!slot) notFound()
  if (slot.status !== 'open') {
    // Slot was booked / cancelled between screens; route back to time
    // list so the user can pick another.
    redirect(`/cabinet/book/${ymd}`)
  }

  // Defense in depth: deny confirmation if the slot belongs to a
  // teacher other than the learner's assigned one. The API book
  // route does the real check; redirect here is for cleaner UX.
  if (
    session.account.assignedTeacherId
    && slot.teacherAccountId !== session.account.assignedTeacherId
  ) {
    redirect('/cabinet/book')
  }

  const profile = await getAccountProfile(session.account.id)
  const tz = profile?.timezone ?? 'Europe/Moscow'

  const start = new Date(slot.startAt)
  const end = new Date(start.getTime() + slot.durationMinutes * 60_000)
  const fmt = (dt: Date) =>
    dt.toLocaleTimeString('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    })
  const weekday = WEEKDAY_NAMES[start.getDay()]
  const month = MONTH_NAMES_GEN[start.getMonth()]
  const dayOfMonth = start.getDate()
  const year = start.getFullYear()

  return (
    <AuthShell>
      <div style={{ width: '100%', maxWidth: 520, padding: '24px 16px' }}>
        <Link
          href={`/cabinet/book/${ymd}`}
          aria-label="Назад к выбору времени"
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

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              marginBottom: 8,
            }}
          >
            Подтвердите запись
          </h1>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 14,
              color: 'var(--secondary)',
            }}
          >
            <li>🕒 {slot.durationMinutes} мин</li>
            <li>📹 Ссылку на встречу пришлём после подтверждения.</li>
            <li>
              📅 {fmt(start)} – {fmt(end)}, {weekday}, {dayOfMonth} {month}{' '}
              {year}
            </li>
            <li>🌐 {tz}</li>
          </ul>
        </div>

        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--border)',
            margin: '0 0 16px 0',
          }}
        />

        <ConfirmForm slotId={slot.id} ymd={ymd} />
      </div>
    </AuthShell>
  )
}
