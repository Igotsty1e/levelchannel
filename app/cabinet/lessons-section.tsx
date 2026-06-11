'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { CancelLessonModal } from '@/components/cabinet/cancel-lesson-modal'
import { MissingPaymentMethodBanner } from '@/components/cabinet/missing-payment-method-banner'
import { PayLessonModal } from '@/components/cabinet/pay-lesson-modal'
import {
  Banner,
  Button,
  DatePicker,
  Pill,
  TimePicker,
} from '@/components/ui/primitives'
import type { LessonSlot } from '@/lib/scheduling/slots'
import { safeTz } from '@/lib/util/tz'

// 2026-06-07: legacy CloudPayments-flow скрыт; новая SBP-self-service
// модель (`teacher-payments-sbp-self-service` epic) активируется
// per-pair через prop `sbpPayEnabled` — true когда у учителя есть
// active payment_method.
const LESSON_PAYMENT_UI_ENABLED = false

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

// Wave 18 — billing-preview banner inside BookConfirmModal needs to
// know which packages this learner has. Server hands those down through
// here verbatim. expiresAt is included so the modal can pick the SAME
// package the server will actually consume (FIFO by expires_at asc,
// matching consumePackageUnit in lib/billing/consumption.ts).
//
// Quality Sub-PR A (2026-06-02): dropped the `postpaidAllowed` prop +
// the BookConfirmModal postpaid-preview banner that depended on it.
// The advisory banner read accounts.postpaid_allowed which became a
// dead column after mig 0101 (booking gates per-pair via
// learner_billing_preferences). The booking server-side gate already
// rejects ineligible bookings with structured reasons
// (payment_method_not_set / package_required / pending_package_grant),
// so the lying banner was removed wholesale. A per-pair preview is a
// follow-up sub-epic — the modal stays silent on the postpaid case
// until then.
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
  // Bug #1 (2026-06-02). Server-derived: true when the assigned
  // teacher has not picked a payment method for this learner
  // (`learner_billing_preferences.payment_method = 'none'`, or no row).
  // Replaces the «Открыть календарь» CTA with the missing-payment-
  // method banner. Plan: docs/plans/bug-1-payment-method-banner.md.
  paymentMethodNotSet: boolean
  // Bug #1: same SoT as the «Купить пакет» CTA gate in billing-
  // sections. Used by the banner's second-paragraph copy.
  canBuyPackages: boolean
  // teacher-payments-sbp-self-service Sub-PR C: per-slot «Оплатить»
  // button рендерим только если у учителя есть активный SBP-метод.
  // Set из `lib/payments/sbp-methods.resolveMethodForLearner` на SSR.
  sbpPayEnabled?: boolean
  // teacher-no-slots-mode (Задача 2.1, Sub-PR B, 2026-06-11). Когда
  // 'direct_assign' — скрываем pickup-секцию (доступные слоты + CTA
  // «Записаться»). Booked-секция остаётся плюс получает кнопку
  // «Перенести».
  teacherSlotMode?: 'open_slots' | 'direct_assign'
}

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
      return 'свободно'
    case 'booked':
      return 'забронировано'
    case 'cancelled':
      return 'отменено'
    case 'completed':
      return 'проведено'
    case 'no_show_learner':
      return 'вы не пришли'
    case 'no_show_teacher':
      return 'учитель не пришёл'
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
  billingWaveActive,
  cancelWindowHours,
  paymentMethodNotSet,
  canBuyPackages,
  sbpPayEnabled = false,
  teacherSlotMode = 'open_slots',
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
  const tz = safeTz(learnerTimezone)
  const [mine, setMine] = useState<LessonSlot[]>(initialMine)
  const [available, setAvailable] = useState<LessonSlot[]>(initialAvailable)
  const paidSet = new Set(initialPaidSlotIds)
  const refundedSet = new Set(initialRefundedSlotIds ?? [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // 2026-06-07 — модал подтверждения отмены. Когда не null, рендерим
  // <CancelLessonModal> поверх — слот хранит контекст для заголовка.
  const [cancelTarget, setCancelTarget] = useState<LessonSlot | null>(null)
  // teacher-no-slots-mode (Задача 2.1, Sub-PR B): reschedule by learner.
  const [rescheduleTarget, setRescheduleTarget] = useState<LessonSlot | null>(
    null,
  )
  // Sub-PR C — модал оплаты выбранного слота.
  const [payTarget, setPayTarget] = useState<LessonSlot | null>(null)

  async function refresh() {
    try {
      // SAAS-PIVOT Day 2 (2026-05-22) — when the learner is bound to
      // at least one teacher we forward ?teacher=<id> to
      // /api/slots/available. /api/slots/mine has no teacher scope
      // (it lists the learner's own bookings) so the param is omitted
      // there. Multi-link learners reach this surface via the
      // first-linked teacher (alias) — Epic 7 polish adds picker UI.
      const availableUrl = assignedTeacherId
        ? `/api/slots/available?teacher=${encodeURIComponent(assignedTeacherId)}`
        : '/api/slots/available'
      const [m, a] = await Promise.all([
        fetch('/api/slots/mine', { cache: 'no-store' }).then((r) => r.json()),
        fetch(availableUrl, { cache: 'no-store' }).then((r) => r.json()),
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
      const bookUrl = assignedTeacherId
        ? `/api/slots/${slotId}/book?teacher=${encodeURIComponent(assignedTeacherId)}`
        : `/api/slots/${slotId}/book`
      const res = await fetch(bookUrl, { method: 'POST' })
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

  async function cancelWithReason(slotId: string, reason: string) {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/slots/${slotId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.error === 'too_late_to_cancel') {
          throw new Error(
            `До начала менее ${effectiveCancelWindowHours} ч — отменить через систему уже нельзя. Напишите учителю напрямую.`,
          )
        }
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
      }
      setInfo('Запись отменена. Учитель получит уведомление.')
      setCancelTarget(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Мои занятия
        </h2>
        {mine.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            У вас пока нет записей. Откройте календарь и выберите
            удобное время.
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
                                {s.status === 'booked'
                                && !s.tariffSlug
                                && paidSet.has(s.id) ? (
                                  <span style={{ marginLeft: 8 }}>
                                    <Pill tone="success" size="sm">
                                      оплачено
                                    </Pill>
                                  </span>
                                ) : null}
                                {LESSON_PAYMENT_UI_ENABLED && s.status === 'booked' && s.tariffSlug ? (
                                  paidSet.has(s.id) ? (
                                    <span style={{ marginLeft: 8 }}>
                                      <Pill tone="success" size="sm">
                                        оплачено
                                      </Pill>
                                    </span>
                                  ) : refundedSet.has(s.id) ? (
                                    // Wave 52 — refund Phase 7 Stage C.
                                    // Slot had a paid allocation that was
                                    // reversed; show a neutral pill so the
                                    // operator doesn't push the learner
                                    // through "оплатить" again.
                                    <span
                                      style={{ marginLeft: 8 }}
                                      title="Оплата за это занятие возвращена. Если нужно оплатить снова — напишите оператору."
                                    >
                                      <Pill tone="default" size="sm">
                                        возврат оформлен
                                      </Pill>
                                    </span>
                                  ) : (
                                    <span style={{ marginLeft: 8 }}>
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        href={`/checkout/${encodeURIComponent(s.tariffSlug)}?slot=${s.id}`}
                                      >
                                        Оплатить
                                        {s.tariffAmountKopecks
                                          ? ` ${formatRub(s.tariffAmountKopecks)}`
                                          : ''}
                                      </Button>
                                    </span>
                                  )
                                ) : null}
                              </span>
                              {s.status === 'booked' && s.zoomUrl ? (
                                <span style={{ marginRight: 8 }}>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    href={s.zoomUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Войти на занятие
                                  </Button>
                                </span>
                              ) : null}
                              {sbpPayEnabled
                              && s.status === 'booked'
                              && !paidSet.has(s.id)
                              && !refundedSet.has(s.id) ? (
                                <span style={{ marginRight: 8 }}>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setPayTarget(s)}
                                    disabled={busy}
                                  >
                                    Оплатить
                                  </Button>
                                </span>
                              ) : null}
                              {s.status === 'booked' && !tooLate ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRescheduleTarget(s)}
                                    disabled={busy}
                                  >
                                    Перенести
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCancelTarget(s)}
                                    disabled={busy}
                                  >
                                    Отменить
                                  </Button>
                                </>
                              ) : s.status === 'booked' && tooLate ? (
                                <span
                                  style={{
                                    color: 'var(--secondary)',
                                    fontSize: 12,
                                  }}
                                  title={`До начала менее ${effectiveCancelWindowHours} ч — отмену делайте через учителя напрямую.`}
                                >
                                  до начала &lt; {effectiveCancelWindowHours} ч
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

      {/* teacher-no-slots-mode (Задача 2.1, Sub-PR B): в режиме
          direct_assign учитель назначает время сам — pickup CTA не
          показываем, вместо него — info-карточку. */}
      {teacherSlotMode === 'direct_assign' ? (
        <DirectAssignInfoCard />
      ) : (
        <BookingCta
          emailVerified={emailVerified}
          hasAssignedTeacher={hasAssignedTeacher}
          paymentMethodNotSet={paymentMethodNotSet}
          canBuyPackages={canBuyPackages}
        />
      )}

      {cancelTarget ? (
        <CancelLessonModal
          slotLabel={`${fmt(cancelTarget.startAt, tz)} · ${cancelTarget.durationMinutes} мин`}
          cancelWindowHours={effectiveCancelWindowHours}
          onConfirm={(reason) => cancelWithReason(cancelTarget.id, reason)}
          onClose={() => (busy ? undefined : setCancelTarget(null))}
        />
      ) : null}

      {payTarget ? (
        <PayLessonModal
          slotId={payTarget.id}
          onClose={() => setPayTarget(null)}
          onSuccess={async () => {
            setPayTarget(null)
            setInfo('Заявка отправлена — ждём подтверждение учителя.')
            await refresh()
          }}
        />
      ) : null}

      {rescheduleTarget ? (
        <RescheduleLessonModal
          slot={rescheduleTarget}
          tz={tz}
          onClose={() => (busy ? undefined : setRescheduleTarget(null))}
          onSuccess={async () => {
            setRescheduleTarget(null)
            setInfo('Занятие перенесено. Учителю отправили уведомление.')
            await refresh()
          }}
        />
      ) : null}
    </>
  )
}

// teacher-no-slots-mode (Задача 2.1, Sub-PR B, 2026-06-11).
// Inline reschedule modal — выбор новой даты + времени. Тариф и
// длительность наследуются от исходного слота (backend копирует).
function RescheduleLessonModal({
  slot,
  tz,
  onClose,
  onSuccess,
}: {
  slot: LessonSlot
  tz: string
  onClose: () => void
  onSuccess: () => void | Promise<void>
}) {
  const startDate = new Date(slot.startAt)
  const initialYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startDate)
  const initialHhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startDate)

  const [date, setDate] = useState(initialYmd)
  const [time, setTime] = useState(initialHhmm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    const t = /^(\d{2}):(\d{2})$/.exec(time)
    if (!m || !t) {
      setError('Дата или время некорректные.')
      setBusy(false)
      return
    }
    // Compose ISO in the learner's tz; backend re-validates MSK
    // business hours + 30-min grid.
    const localDate = new Date(`${date}T${time}:00`)
    const tzOffset = -localDate.getTimezoneOffset()
    const isoUtc = new Date(
      localDate.getTime() - tzOffset * 60_000,
    ).toISOString()

    try {
      const res = await fetch(`/api/slots/${slot.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStartAt: isoUtc }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          RESCHEDULE_REASON_COPY[body?.error] ??
            `Не удалось перенести (HTTP ${res.status}).`,
        )
        setBusy(false)
        return
      }
      await onSuccess()
    } catch (e) {
      setError(
        `Сеть недоступна: ${e instanceof Error ? e.message : String(e)}`,
      )
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Перенести занятие"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 20,
          color: 'var(--text)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
          Перенести занятие
        </h2>
        <p
          style={{
            margin: '4px 0 16px',
            fontSize: 13,
            color: 'var(--text-secondary, var(--secondary))',
          }}
        >
          Текущее время: {fmt(slot.startAt, tz)}.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-secondary, var(--secondary))',
              marginBottom: 6,
            }}
          >
            Новая дата
          </label>
          <DatePicker
            value={date}
            onChange={setDate}
            disabled={busy}
            ariaLabel="Новая дата занятия"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-secondary, var(--secondary))',
              marginBottom: 6,
            }}
          >
            Новое время
          </label>
          <TimePicker
            value={time}
            onChange={setTime}
            hourMin={6}
            hourMax={21}
            granularity={1}
            disabled={busy}
            ariaLabel="Новое время начала"
          />
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: 10,
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={cancelBtnStyle}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            style={submitBtnStyle}
          >
            {busy ? 'Переносим…' : 'Перенести'}
          </button>
        </div>
      </div>
    </div>
  )
}

const RESCHEDULE_REASON_COPY: Record<string, string> = {
  not_found: 'Занятие не найдено.',
  not_owner: 'Это занятие не ваше.',
  already_terminal: 'Это занятие нельзя перенести — уже завершено или отменено.',
  too_late_to_reschedule:
    'Слишком близко к началу. Перенос делайте через учителя напрямую.',
  in_past: 'Время уже прошло.',
  start_out_of_band: 'Время вне рабочих часов (06:00–22:00 МСК).',
  start_not_30min_aligned: 'Время должно быть кратно 30 минутам.',
  slot_collision: 'На это время у учителя уже есть занятие.',
  external_conflict:
    'На это время у учителя — внешняя метка занятости в Google Calendar.',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 15,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: 'transparent',
  color: 'var(--text-secondary, var(--secondary))',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const submitBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: 'var(--accent)',
  color: 'var(--text-on-accent, #fff)',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

// teacher-no-slots-mode (Задача 2.1, Sub-PR B, 2026-06-11). Info-карточка
// для учеников, чей учитель в режиме direct_assign. Заменяет BookingCta:
// pickup-flow для них недоступен.
function DirectAssignInfoCard() {
  return (
    <div
      role="status"
      style={{
        marginTop: 16,
        padding: 16,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        Учитель сам назначает время занятий
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--text-secondary, var(--secondary))',
          lineHeight: 1.5,
        }}
      >
        Когда учитель выберет время для следующего занятия, вы получите письмо.
        Перенести или отменить занятие можно из карточки выше.
      </p>
    </div>
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
  paymentMethodNotSet,
  canBuyPackages,
}: {
  emailVerified: boolean
  hasAssignedTeacher: boolean
  // Bug #1 — see Props on LessonsSection.
  paymentMethodNotSet: boolean
  canBuyPackages: boolean
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
        <Banner
          tone="success"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBanner(false)}
              aria-label="Скрыть уведомление"
            >
              ×
            </Button>
          }
        >
          Записано. Занятие появилось в разделе «Мои занятия» выше.
        </Banner>
      ) : null}

      {/* Happy-path: H2 + основная CTA на одной строке (без filler-
          подзаголовка) — это второй primary-CTA сразу под «Мои занятия».
          На «несчастливых» путях (нет учителя / непроверенный e-mail /
          payment_method_not_set) разворачиваем объяснение, потому что
          там кнопка либо не появится, либо её клик упрётся в банкер. */}
      {!hasAssignedTeacher ? (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
            Записаться на занятие
          </h2>
          <p style={{ color: 'var(--secondary)', fontSize: 14, margin: 0 }}>
            Учитель пока не подключён. Напишите оператору, чтобы он привязал
            вас, — после этого здесь появится кнопка записи.
          </p>
        </>
      ) : !emailVerified ? (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
            Записаться на занятие
          </h2>
          <p style={{ color: 'var(--warning)', fontSize: 13, margin: 0 }}>
            Чтобы записаться, сначала подтвердите e-mail (см. баннер выше).
          </p>
        </>
      ) : paymentMethodNotSet ? (
        // Bug #1 (2026-06-02): show the missing-payment-method banner
        // in place of the «Открыть календарь» CTA. Booking-side gate
        // in lib/scheduling/slots/booking.ts:249-252 remains as
        // defense-in-depth. Plan: docs/plans/bug-1-payment-method-
        // banner.md.
        <>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
            Записаться на занятие
          </h2>
          <MissingPaymentMethodBanner
            variant="single"
            canBuyPackages={canBuyPackages}
          />
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Записаться на занятие
          </h2>
          <Button href="/cabinet/book">Открыть календарь</Button>
        </div>
      )}
    </div>
  )
}

