'use client'

import { useEffect, useState } from 'react'

import { BookConfirmModal } from '@/components/calendar/BookConfirmModal'
import { SlotCalendar } from '@/components/calendar/SlotCalendar'
import type { CalendarRow } from '@/lib/calendar/view-model'
import type { LessonSlot } from '@/lib/scheduling/slots'

type Props = {
  initialMine: LessonSlot[]
  initialAvailable: LessonSlot[]
  learnerTimezone: string | null
  emailVerified: boolean
  initialPaidSlotIds: string[]
  // When false, the cabinet renders a "ваш учитель ещё не назначен"
  // hint instead of an empty available-list. The page passes this
  // from `account.assignedTeacherId ? true : false`.
  hasAssignedTeacher: boolean
  // Wave B — learner-side calendar tab needs the actual teacher id
  // (not just the boolean) to query /api/slots/calendar?teacherId=…
  // Pass null for unbound learners; calendar tab is disabled in that
  // case (the existing «учитель не назначен» hint already covers).
  assignedTeacherId: string | null
}

const TZ_DEFAULT = 'Europe/Moscow'

function fmt(slotIso: string, tz: string): string {
  return new Date(slotIso).toLocaleString('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'свободен'
    case 'booked':
      return 'забронирован'
    case 'cancelled':
      return 'отменён'
    case 'completed':
      return 'проведён'
    case 'no_show_learner':
      return 'не пришёл (вы)'
    case 'no_show_teacher':
      return 'не пришёл учитель'
    default:
      return status
  }
}

const HOURS_24_MS = 24 * 60 * 60 * 1000

function isTooLateToCancel(startAtIso: string): boolean {
  return new Date(startAtIso).getTime() - Date.now() < HOURS_24_MS
}

export function LessonsSection({
  initialMine,
  initialAvailable,
  learnerTimezone,
  emailVerified,
  initialPaidSlotIds,
  hasAssignedTeacher,
  assignedTeacherId,
}: Props) {
  // Defensive: if a pre-whitelist profile carries a bad value, fall
  // back to Europe/Moscow rather than crash the cabinet on the first
  // Date.toLocaleString call.
  const tz = (() => {
    const candidate = learnerTimezone ?? TZ_DEFAULT
    try {
      new Intl.DateTimeFormat('ru-RU', { timeZone: candidate })
      return candidate
    } catch {
      return TZ_DEFAULT
    }
  })()
  const [mine, setMine] = useState<LessonSlot[]>(initialMine)
  const [available, setAvailable] = useState<LessonSlot[]>(initialAvailable)
  const paidSet = new Set(initialPaidSlotIds)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function refresh() {
    try {
      const [m, a] = await Promise.all([
        fetch('/api/slots/mine', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/slots/available', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setMine(m.slots ?? [])
      setAvailable(a.slots ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    }
  }

  // Fresh-load on mount in case the learner just verified their email
  // in another tab — server-rendered lists could be stale.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function book(slotId: string) {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/slots/${slotId}/book`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.error === 'email_not_verified') {
          setErr('Подтвердите e-mail, чтобы записаться на занятие.')
        } else {
          setErr(data?.error || `HTTP ${res.status}`)
        }
        return
      }
      setInfo('Записано.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function cancel(slotId: string) {
    if (!confirm('Отменить запись?')) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/slots/${slotId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.error === 'too_late_to_cancel') {
          setErr(
            'До начала менее 24 часов — отменить через систему уже нельзя. Напишите оператору.',
          )
        } else {
          setErr(data?.error || `HTTP ${res.status}`)
        }
        return
      }
      setInfo('Запись отменена.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Мои уроки
        </h2>
        {mine.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            У вас пока нет записей. Запишитесь на свободный слот ниже.
          </p>
        ) : (
          <>
            {(() => {
              const upcoming = mine.filter(
                (s) => new Date(s.startAt).getTime() > Date.now(),
              )
              const past = mine.filter(
                (s) => new Date(s.startAt).getTime() <= Date.now(),
              )
              return (
                <>
                  {upcoming.length > 0 ? (
                    <>
                      <p
                        style={{
                          color: 'var(--secondary)',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          marginBottom: 4,
                        }}
                      >
                        Предстоящие
                      </p>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {upcoming.map((s) => {
                          const tooLate = isTooLateToCancel(s.startAt)
                          return (
                            <li
                              key={s.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 0',
                                borderTop: '1px solid var(--border)',
                                fontSize: 14,
                              }}
                            >
                              <span>
                                {fmt(s.startAt, tz)} ·{' '}
                                <span style={{ color: 'var(--secondary)' }}>
                                  {s.durationMinutes} мин ·{' '}
                                  {statusLabel(s.status)}
                                </span>
                                {s.status === 'booked' && s.tariffSlug ? (
                                  paidSet.has(s.id) ? (
                                    <span
                                      style={{
                                        marginLeft: 8,
                                        fontSize: 11,
                                        padding: '1px 8px',
                                        borderRadius: 4,
                                        background: 'rgba(155,223,155,0.15)',
                                        color: '#9bdf9b',
                                      }}
                                    >
                                      оплачено
                                    </span>
                                  ) : (
                                    <a
                                      href={`/checkout/${encodeURIComponent(s.tariffSlug)}?slot=${s.id}`}
                                      style={{
                                        marginLeft: 8,
                                        fontSize: 11,
                                        padding: '1px 8px',
                                        borderRadius: 4,
                                        background: 'rgba(255,196,0,0.15)',
                                        color: '#ffd166',
                                        textDecoration: 'none',
                                      }}
                                    >
                                      оплатить{' '}
                                      {s.tariffAmountKopecks
                                        ? `${(s.tariffAmountKopecks / 100).toLocaleString('ru-RU')}\u00a0₽`
                                        : ''}
                                    </a>
                                  )
                                ) : null}
                              </span>
                              {s.status === 'booked' && !tooLate ? (
                                <button
                                  type="button"
                                  onClick={() => cancel(s.id)}
                                  disabled={busy}
                                  style={{
                                    padding: '4px 10px',
                                    background: 'transparent',
                                    color: '#ffcfcf',
                                    border: '1px solid #ff8a8a55',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    cursor: busy ? 'wait' : 'pointer',
                                  }}
                                >
                                  Отменить
                                </button>
                              ) : s.status === 'booked' && tooLate ? (
                                <span
                                  style={{
                                    color: 'var(--secondary)',
                                    fontSize: 11,
                                    fontStyle: 'italic',
                                  }}
                                  title="До начала менее 24 часов. Напишите оператору."
                                >
                                  &lt;24ч — через оператора
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  ) : null}
                  {past.length > 0 ? (
                    <>
                      <p
                        style={{
                          color: 'var(--secondary)',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          marginTop: upcoming.length > 0 ? 16 : 0,
                          marginBottom: 4,
                        }}
                      >
                        Прошедшие
                      </p>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {past.map((s) => (
                          <li
                            key={s.id}
                            style={{
                              padding: '10px 0',
                              borderTop: '1px solid var(--border)',
                              fontSize: 14,
                              color: 'var(--secondary)',
                            }}
                          >
                            {fmt(s.startAt, tz)} ·{' '}
                            {s.durationMinutes} мин · {statusLabel(s.status)}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )
            })()}
          </>
        )}
      </div>

      <BookSection
        available={available}
        emailVerified={emailVerified}
        hasAssignedTeacher={hasAssignedTeacher}
        assignedTeacherId={assignedTeacherId}
        learnerTimezone={tz}
        tz={tz}
        busy={busy}
        info={info}
        err={err}
        onBook={book}
        onRefresh={refresh}
      />
    </>
  )
}

// Wave B — book section: calendar tab (default) + list tab fallback.
// Calendar gives a visual scan past 10+ slots; list keeps power-user
// inline density. Codex 2026-05-08 design: NO cancel surface inside
// the calendar — booked-self click shows a read-only modal with a
// hint pointing to «Мои уроки». Cancel ownership stays in one place.
function BookSection({
  available,
  emailVerified,
  hasAssignedTeacher,
  assignedTeacherId,
  learnerTimezone,
  tz,
  busy,
  info,
  err,
  onBook,
  onRefresh,
}: {
  available: LessonSlot[]
  emailVerified: boolean
  hasAssignedTeacher: boolean
  assignedTeacherId: string | null
  learnerTimezone: string
  tz: string
  busy: boolean
  info: string | null
  err: string | null
  onBook: (slotId: string) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [tab, setTab] = useState<'calendar' | 'list'>('calendar')
  const [activeRow, setActiveRow] = useState<CalendarRow | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)

  function bumpReload() {
    setReloadCounter((n) => n + 1)
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Записаться
        </h2>
        {hasAssignedTeacher ? (
          <div role="tablist" aria-label="Вид расписания" style={{ display: 'flex', gap: 6 }}>
            <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
              Календарь
            </TabButton>
            <TabButton active={tab === 'list'} onClick={() => setTab('list')}>
              Список
            </TabButton>
          </div>
        ) : null}
      </div>
      {!emailVerified ? (
        <p style={{ color: '#ffcfcf', fontSize: 13, marginBottom: 12 }}>
          Чтобы записаться, сначала подтвердите e-mail (см. баннер выше).
        </p>
      ) : null}
      {info ? (
        <p style={{ color: '#9bdf9b', fontSize: 13, marginBottom: 8 }}>{info}</p>
      ) : null}
      {err ? (
        <p style={{ color: '#ff8a8a', fontSize: 13, marginBottom: 8 }}>{err}</p>
      ) : null}
      {!hasAssignedTeacher ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          Учитель пока не назначен — напишите оператору, чтобы добавил.
          Расписание появится здесь, когда он будет привязан к вашему
          аккаунту.
        </p>
      ) : tab === 'calendar' && assignedTeacherId ? (
        <>
          {learnerTimezone !== 'Europe/Moscow' ? (
            <p
              style={{
                color: 'var(--secondary)',
                fontSize: 12,
                marginBottom: 10,
                lineHeight: 1.5,
              }}
            >
              Время в календаре указано по Москве (МСК). При записи
              откроется окно с пересчётом на ваш часовой пояс
              ({learnerTimezone}).
            </p>
          ) : null}
          <SlotCalendar
            key={`learner-${assignedTeacherId}-${reloadCounter}`}
            teacherId={assignedTeacherId}
            initialFromYmd={currentMondayYmd()}
            onSlotClick={(row) => setActiveRow(row)}
            // Codex Wave B: no interactions for learners; click-only
            // booking surface. Drag features stay operator-only.
          />
        </>
      ) : available.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          У вашего учителя сейчас нет свободных слотов. Напишите
          оператору, чтобы добавил.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {available.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderTop: '1px solid var(--border)',
                fontSize: 14,
              }}
            >
              <span>
                {fmtSlotTime(s.startAt, tz)} ·{' '}
                <span style={{ color: 'var(--secondary)' }}>
                  {s.durationMinutes} мин
                </span>
              </span>
              <button
                type="button"
                onClick={() => onBook(s.id)}
                disabled={busy || !emailVerified}
                style={{
                  padding: '4px 12px',
                  background: 'var(--accent)',
                  color: 'var(--accent-contrast)',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: busy || !emailVerified ? 'not-allowed' : 'pointer',
                  opacity: busy || !emailVerified ? 0.6 : 1,
                }}
              >
                Записаться
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeRow ? (
        <BookConfirmModal
          row={activeRow}
          emailVerified={emailVerified}
          learnerTimezone={learnerTimezone}
          onClose={() => setActiveRow(null)}
          onBooked={() => {
            setActiveRow(null)
            // Codex Wave B invariant: refetch on success — re-pulls
            // /api/slots/mine + /api/slots/available, and key bump
            // forces calendar to /api/slots/calendar.
            void onRefresh()
            bumpReload()
          }}
          onConflict={() => {
            // Codex Wave B post-review: 409 race must trigger a
            // background refetch even though the modal stays
            // mounted. Otherwise the calendar still shows the slot
            // as `open` and the user re-clicks → 409 loop.
            void onRefresh()
            bumpReload()
          }}
        />
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 13,
        background: active
          ? 'rgba(59, 130, 246, 0.15)'
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 6,
        color: active ? '#bfdbfe' : '#e4e4e7',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}

function fmtSlotTime(slotIso: string, tz: string): string {
  return new Date(slotIso).toLocaleString('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function currentMondayYmd(): string {
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
