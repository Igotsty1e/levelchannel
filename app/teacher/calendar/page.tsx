import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { countHiddenSlotsForTeacher } from '@/lib/calendar/hidden-slots'
import { getTeacherCalendarSummary } from '@/lib/calendar/summary'
import { getDbPool } from '@/lib/db/pool'
import { listActiveTariffs } from '@/lib/pricing/tariffs'

import { CalendarSummary } from '@/components/calendar/CalendarSummary'
import TeacherCalendarClient from './client'

// SSR snapshot of future-booked, conflict-stamped slots. BCS-F.3
// added a `router.refresh()` call to the slot modal success path,
// so this count rebuilds on every conflict mutation (cancel /
// dismiss / delete-external).
async function countTeacherConflicts(teacherAccountId: string): Promise<number> {
  const r = await getDbPool().query(
    `select count(*)::int as n
       from lesson_slots
      where teacher_account_id = $1
        and status = 'booked'
        and external_conflict_at is not null
        and start_at > now()`,
    [teacherAccountId],
  )
  return Number(r.rows[0]?.n ?? 0)
}

// Wave A PR4 — full-week teacher calendar. Reads the session a second
// time (after the layout already gated) only to surface the teacher's
// own accountId to the client island. The layout is the security gate;
// this just hands the resolved id down without re-checking roles.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function TeacherPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }

  // SAAS-PIVOT Epic 2 Day 3 — teacher catalogue is now per-teacher.
  // Pass the current teacher's account id so the calendar's tariff
  // dropdown only sees this teacher's own tariffs (cross-teacher
  // leakage gate at the data layer).
  const tariffs = await listActiveTariffs({ teacherId: current.account.id })
  const conflictCount = await countTeacherConflicts(current.account.id)
  const hiddenCount = await countHiddenSlotsForTeacher(current.account.id)
  const fromYmd = currentMondayYmd()
  const summary = await getTeacherCalendarSummary(current.account.id, fromYmd)
  const nextSlotView = summary.nextSlot
    ? {
        label: summary.nextSlot.label,
        hhmm: new Intl.DateTimeFormat('ru-RU', {
          timeZone: summary.teacherTz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(summary.nextSlot.startAt)),
        dayLabel: new Intl.DateTimeFormat('ru-RU', {
          timeZone: summary.teacherTz,
          day: 'numeric',
          month: 'short',
        }).format(new Date(summary.nextSlot.startAt)),
      }
    : null
  const todayDateLabel = new Intl.DateTimeFormat('ru-RU', {
    timeZone: summary.teacherTz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
  // Sub-PR B (TASK-1) removed the always-visible Google Calendar status
  // row + the 3-link nav stop-gap — connection state now surfaces via
  // the ●/○ dot in TeacherCabinetNav. Conflict + hidden-slot banners
  // stay (urgent-action surfaces).
  // Mobile-first restructure (2026-05-31) — digest preview переехал
  // в /teacher/settings (раздел «Уведомления»). На календаре остаются
  // только urgent-action banners (конфликт / hidden slots).

  return (
    <>
      <CalendarSummary
        todayCount={summary.todayCount}
        nextSlot={nextSlotView}
        weekBookedCount={summary.weekBookedCount}
        weekOpenCount={summary.weekOpenCount}
        weekEarningsKopecks={summary.weekEarningsKopecks}
        conflictCount={conflictCount}
        hiddenCount={hiddenCount}
        todayLabel={todayDateLabel}
      />
      <TeacherCalendarClient
        teacherId={current.account.id}
        initialFromYmd={fromYmd}
        tariffs={tariffs.map((t) => ({
          id: t.id,
          slug: t.slug,
          titleRu: t.titleRu,
          amountKopecks: t.amountKopecks,
        }))}
      />
    </>
  )
}

function currentMondayYmd(): string {
  // MSK Monday of the current week. Mirrors the operator demo route.
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(now)
  let y = 0,
    m = 0,
    d = 0,
    weekday = ''
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value)
    if (p.type === 'month') m = Number(p.value)
    if (p.type === 'day') d = Number(p.value)
    if (p.type === 'weekday') weekday = p.value
  }
  const dowMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  }
  const offset = dowMap[weekday] ?? 0
  const monday = new Date(Date.UTC(y, m - 1, d - offset))
  return monday.toISOString().slice(0, 10)
}
