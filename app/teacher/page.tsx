import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listActiveTariffs } from '@/lib/pricing/tariffs'

import TeacherCalendarClient from './client'

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

  const tariffs = await listActiveTariffs()

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Мой календарь
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Перетащите по пустым ячейкам — откроется диалог создания.
        Перетащите свободный слот по вертикали — он переместится.
        Кликните по существующему слоту, чтобы посмотреть детали или
        отменить (для занятых нужна причина для ученика).
      </p>
      <TeacherCalendarClient
        teacherId={current.account.id}
        initialFromYmd={currentMondayYmd()}
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
