'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { BookConfirmModal } from '@/components/calendar/BookConfirmModal'
import { SlotCalendar } from '@/components/calendar/SlotCalendar'
import type { CalendarRow } from '@/lib/calendar/view-model'
import type { LessonSlot } from '@/lib/scheduling/slots'

// Wave 18 — billing-preview banner inside BookConfirmModal needs to
// know which packages this learner has and whether they're allowed
// postpaid. Server hands those down through here verbatim. expiresAt
// is included so the modal can pick the SAME package the server will
// actually consume (FIFO by expires_at asc, matching consumePackageUnit
// in lib/billing/consumption.ts).
export type LearnerActivePackage = {
  id: string
  titleSnapshot: string
  durationMinutes: number
  countRemaining: number
  countInitial: number
  expiresAt: string
}

type Props = {
  initialMine: LessonSlot[]
  initialAvailable: LessonSlot[]
  learnerTimezone: string | null
  emailVerified: boolean
  initialPaidSlotIds: string[]
  // Wave 52 — refund Phase 7. A slot in this list HAD a paid
  // allocation that got reversed. Renders a neutral "возврат
  // оформлен" pill instead of the yellow "оплатить X₽" CTA.
  initialRefundedSlotIds?: string[]
  // When false, the cabinet renders a "ваш учитель ещё не назначен"
  // hint instead of an empty available-list. The page passes this
  // from `account.assignedTeacherId ? true : false`.
  hasAssignedTeacher: boolean
  // Wave B — learner-side calendar tab needs the actual teacher id
  // (not just the boolean) to query /api/slots/calendar?teacherId=…
  // Pass null for unbound learners; calendar tab is disabled in that
  // case (the existing «учитель не назначен» hint already covers).
  assignedTeacherId: string | null
  activePackages: LearnerActivePackage[]
  postpaidAllowed: boolean
  // Wave 18 — server-side BILLING_WAVE_ACTIVE flag. When false,
  // the booking endpoint goes through the legacy single-statement
  // path with no package/postpaid logic. The preview banner then
  // would lie, so we hide it.
  billingWaveActive: boolean
  // POLICY-KNOBS (2026-05-17) — minimum hours-until-start required
  // for a learner self-service cancel. Materialised by the server
  // component from getLearnerCancelWindowHours(). Default 24, env-
  // tunable via LEARNER_CANCEL_WINDOW_HOURS.
  // POLICY-KNOBS follow-up: component-level test once jsdom+RTL lands
  // in vitest config — gap intentionally documented per round-2 WARN
  // #3 closure in docs/plans/policy-knobs.md.
  cancelWindowHours: number
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

// POLICY-KNOBS (2026-05-17) — fallback for the cancel window if the
// prop somehow arrives undefined/NaN. The server component is
// expected to always pass a finite int from getLearnerCancelWindowHours;
// this guard keeps the UI from silently leaving the cancel button
// enabled (which would happen with `undefined * 60 * 60 * 1000 === NaN`).
// See docs/plans/policy-knobs.md §3.4 for the asymmetric failure modes
// when fallback ≠ server policy.
const FALLBACK_CANCEL_WINDOW_HOURS = 24

export function LessonsSection({
  initialMine,
  initialAvailable,
  learnerTimezone,
  emailVerified,
  initialPaidSlotIds,
  initialRefundedSlotIds,
  hasAssignedTeacher,
  assignedTeacherId,
  activePackages,
  postpaidAllowed,
  billingWaveActive,
  cancelWindowHours,
}: Props) {
  const effectiveCancelWindowHours =
    Number.isFinite(cancelWindowHours)
    && Number.isInteger(cancelWindowHours)
    && cancelWindowHours >= 0
      ? cancelWindowHours
      : FALLBACK_CANCEL_WINDOW_HOURS
  const cancelThresholdMs = effectiveCancelWindowHours * 60 * 60 * 1000

  function isTooLateToCancel(startAtIso: string): boolean {
    return new Date(startAtIso).getTime() - Date.now() < cancelThresholdMs
  }
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
  const refundedSet = new Set(initialRefundedSlotIds ?? [])
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
          setErr(data?.message || data?.error || `HTTP `)
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
            `До начала менее ${effectiveCancelWindowHours} ч — отменить через систему уже нельзя. Напишите оператору.`,
          )
        } else {
          setErr(data?.message || data?.error || `HTTP `)
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
            У вас пока нет записей. Выберите свободное время ниже.
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
                                  ) : refundedSet.has(s.id) ? (
                                    // Wave 52 — refund Phase 7 Stage C.
                                    // Slot had a paid allocation that was
                                    // reversed; show a neutral pill so the
                                    // operator doesn't push the learner
                                    // through "оплатить" again.
                                    <span
                                      style={{
                                        marginLeft: 8,
                                        fontSize: 11,
                                        padding: '1px 8px',
                                        borderRadius: 4,
                                        background: 'rgba(180,180,180,0.15)',
                                        color: '#cfcfcf',
                                      }}
                                      title="Оплата за это занятие была возвращена. Если требуется снова оплатить, свяжитесь с оператором."
                                    >
                                      возврат оформлен
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
                              {s.status === 'booked' && s.zoomUrl ? (
                                <a
                                  href={s.zoomUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    marginRight: 8,
                                    padding: '4px 10px',
                                    background: 'rgba(155,223,155,0.15)',
                                    color: '#9bdf9b',
                                    border: '1px solid rgba(155,223,155,0.4)',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    textDecoration: 'none',
                                  }}
                                >
                                  ▶ Войти на занятие
                                </a>
                              ) : null}
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
                                  title={`До начала менее ${effectiveCancelWindowHours} ч. Напишите оператору.`}
                                >
                                  &lt;{effectiveCancelWindowHours}ч — через оператора
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

      <BookingCta
        emailVerified={emailVerified}
        hasAssignedTeacher={hasAssignedTeacher}
      />
    </>
  )
}

// BCS-B.frontend — replaces the legacy inline BookSection. The dense
// in-cabinet grid moved to a dedicated 3-screen Calendly flow at
// /cabinet/book. Fast-path tiles ("Ближайший свободный" / "Как в
// прошлый раз") will land in a follow-up PR (BCS-B.frontend-fastpath).
//
// Success banner: reads `?booked=1` from the URL (set by the confirm
// form on successful POST) and renders a green tick. The query is left
// in the URL on first paint and cleared client-side after first render
// so a refresh doesn't show the banner forever.
function BookingCta({
  emailVerified,
  hasAssignedTeacher,
}: {
  emailVerified: boolean
  hasAssignedTeacher: boolean
}) {
  const params = useSearchParams()
  const justBooked = params.get('booked') === '1'
  const [showBanner, setShowBanner] = useState(justBooked)

  useEffect(() => {
    if (!justBooked) return
    // Strip the query so a refresh doesn't keep the banner.
    const next = new URL(window.location.href)
    next.searchParams.delete('booked')
    window.history.replaceState({}, '', next.toString())
  }, [justBooked])

  return (
    <div
      className="card"
      style={{ padding: 24, marginBottom: 24 }}
    >
      {showBanner ? (
        <p
          role="status"
          style={{
            background: 'rgba(155,223,155,0.15)',
            color: '#9bdf9b',
            padding: '10px 14px',
            borderRadius: 6,
            margin: '0 0 16px 0',
            fontSize: 13,
          }}
        >
          ✓ Записано. Урок появился в разделе «Мои уроки» выше.
          <button
            type="button"
            onClick={() => setShowBanner(false)}
            aria-label="Скрыть уведомление"
            style={{
              float: 'right',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ✕
          </button>
        </p>
      ) : null}

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
        Записаться на урок
      </h2>

      {!hasAssignedTeacher ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14, margin: 0 }}>
          Учитель пока не назначен — напишите оператору, чтобы добавил.
          Кнопка записи появится здесь после привязки.
        </p>
      ) : !emailVerified ? (
        <p style={{ color: '#ffcfcf', fontSize: 13, margin: 0 }}>
          Чтобы записаться, сначала подтвердите e-mail (см. баннер выше).
        </p>
      ) : (
        <>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              marginTop: 0,
              marginBottom: 16,
            }}
          >
            Выберите удобный день и время в календаре.
          </p>
          <Link
            href="/cabinet/book"
            style={{
              display: 'inline-block',
              padding: '12px 20px',
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              borderRadius: 999,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Открыть календарь
          </Link>
        </>
      )}
    </div>
  )
}

