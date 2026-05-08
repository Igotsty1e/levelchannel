import { listAccountsByRole } from '@/lib/auth/accounts'

import CalendarDemoClient from './client'

// Wave A PR2 — operator-only demo route for the calendar component
// skeleton. Renders against `/api/slots/calendar` with the first
// teacher in the system as the default selection. PR3 will wire the
// real /admin/slots calendar tab; this is just for visual inspection.

export const dynamic = 'force-dynamic'

export default async function CalendarDemoPage() {
  const teachers = await listAccountsByRole('teacher')
  const initialFrom = currentMondayYmd()
  return (
    <main style={{ padding: 24, color: '#e4e4e7' }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Calendar demo (Wave A PR2)</h1>
      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 24 }}>
        Read-only demo of the calendar component skeleton. Pick a teacher
        below; calendar fetches from <code>/api/slots/calendar</code> and
        renders pixel-precise slot blocks with auto-stamping per role.
      </p>
      <CalendarDemoClient
        teachers={teachers.map((t) => ({ id: t.id, email: t.email }))}
        initialFromYmd={initialFrom}
      />
    </main>
  )
}

function currentMondayYmd(): string {
  // MSK Monday of current week.
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(now)
  let y = 0, m = 0, d = 0, weekday = ''
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value)
    if (p.type === 'month') m = Number(p.value)
    if (p.type === 'day') d = Number(p.value)
    if (p.type === 'weekday') weekday = p.value
  }
  const dowMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  }
  const offset = dowMap[weekday] ?? 0
  const monday = new Date(Date.UTC(y, m - 1, d - offset))
  return monday.toISOString().slice(0, 10)
}
