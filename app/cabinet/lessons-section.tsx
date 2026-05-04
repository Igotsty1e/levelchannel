'use client'

import { useEffect, useState } from 'react'

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

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Записаться
        </h2>
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
                  {fmt(s.startAt, tz)} ·{' '}
                  <span style={{ color: 'var(--secondary)' }}>
                    {s.durationMinutes} мин
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => book(s.id)}
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
      </div>
    </>
  )
}
