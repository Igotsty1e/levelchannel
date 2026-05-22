import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getActiveTeacherIdsForLearner } from '@/lib/auth/teacher-scope'
import { safeTimezone } from '@/lib/auth/timezones'
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

export default async function BookConfirmPage({ params }: RouteParams) {
  const { ymd, slotId } = await params

  if (!isValidYmd(ymd)) redirect('/cabinet/book')

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')
  if (!session.account.emailVerifiedAt) redirect('/cabinet')

  // BCS-B.frontend Codex #2: single indistinguishable outcome for any
  // case where this learner shouldn't see this slot. notFound() is
  // returned for: missing slot, foreign-teacher slot, or learner
  // without an assigned teacher at all. Only after we've confirmed
  // the slot is OURS do we branch on status.
  //
  // SAAS-PIVOT Day 2 (2026-05-22) — n:m teacher context (plan §2.5).
  // A learner may have multiple active links; the confirm screen
  // accepts the slot if its teacher_account_id is ANY of the
  // learner's active links. The booking POST itself is anti-spoof
  // again via expectedTeacherId (?teacher=<id> required for multi-
  // link). No need to require ?teacher= here — the read screen just
  // checks membership.
  const slot = await getSlotById(slotId)
  const allowedTeacherIds = await getActiveTeacherIdsForLearner(
    session.account.id,
  )
  if (
    !slot
    || allowedTeacherIds.length === 0
    || !allowedTeacherIds.includes(slot.teacherAccountId)
  ) {
    notFound()
  }
  if (slot.status !== 'open') {
    // Slot was booked / cancelled between screens; route back to time
    // list so the user can pick another.
    redirect(`/cabinet/book/${ymd}`)
  }

  const profile = await getAccountProfile(session.account.id)
  const tz = safeTimezone(profile?.timezone)

  // Codex #3: every date part (weekday/day/month/year) must come from
  // the learner's tz, not the server's. Combined formatter does the
  // full localization in one pass.
  const start = new Date(slot.startAt)
  const end = new Date(start.getTime() + slot.durationMinutes * 60_000)
  const fmt = (dt: Date) =>
    dt.toLocaleTimeString('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    })
  const dateParts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
    .formatToParts(start)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})
  const weekday = dateParts.weekday ?? ''
  const month = dateParts.month ?? ''
  const dayOfMonth = dateParts.day ?? ''
  const year = dateParts.year ?? ''

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

        <ConfirmForm
          slotId={slot.id}
          ymd={ymd}
          teacherAccountId={slot.teacherAccountId}
        />
      </div>
    </AuthShell>
  )
}
