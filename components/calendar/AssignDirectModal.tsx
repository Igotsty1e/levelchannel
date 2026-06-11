'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

import {
  ChipGroup,
  Combobox,
  type ComboboxOption,
  DatePicker,
  TimePicker,
} from '@/components/ui/primitives'

const MODE_OPTIONS = [
  { value: 'single', label: 'Одно занятие' },
  { value: 'bulk', label: 'Серия' },
] as const

// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11).
//
// Учитель назначает занятие конкретному ученику с тарифом. Модалка
// зеркалит chrome BulkAddSlotsModal / MobileCreateFab чтобы не вводить
// новый визуальный язык. Полевой набор: ученик (Combobox) + дата +
// время-от (single half-hour) + тариф (Combobox; duration берётся из
// тарифа).
//
// Submit → POST /api/teacher/slots/assign-direct.
// 422/403/409 reasons мапим в человеческий текст; 201 → reload + toast.

export type AssignTariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
  durationMinutes?: number
}

type LearnerListResponse = {
  items: Array<{
    learnerId: string
    learnerEmail: string
    displayName: string | null
    firstName: string | null
    lastName: string | null
    // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
    paymentMethod: 'postpaid' | 'none'
  }>
}

// epic-b Sub-PR B.2 (2026-06-11): per-pair billing state for the
// payment-choice selector. Fetched on learner select; updates the
// "Способ оплаты" panel.
type BillingStateResponse = {
  paymentMethod: 'postpaid' | 'none'
  postpaidAllowed: boolean
  activePackages: Array<{
    id: string
    titleRu: string
    durationMinutes: number
    countRemaining: number
    expiresAt: string
  }>
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoLocalToUtcIso(
  dateYmd: string,
  hhmm: string,
  ianaTz: string,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd)
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m || !t) return null
  const [, y, mo, d] = m
  const [, hh, mm] = t
  const naiveUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    0,
  )
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = dtf.formatToParts(new Date(naiveUtc))
    const got: Record<string, string> = {}
    for (const p of parts) got[p.type] = p.value
    const gotUtc = Date.UTC(
      Number(got.year),
      Number(got.month) - 1,
      Number(got.day),
      Number(got.hour) % 24,
      Number(got.minute),
      0,
    )
    const diff = naiveUtc - gotUtc
    return new Date(naiveUtc + diff).toISOString()
  } catch {
    return null
  }
}

function formatLearnerLabel(it: LearnerListResponse['items'][number]): string {
  const joined = [it.firstName, it.lastName].filter(Boolean).join(' ').trim()
  if (joined.length > 0) return joined
  if (it.displayName && it.displayName.trim().length > 0) {
    return it.displayName.trim()
  }
  return it.learnerEmail
}

const REASON_COPY: Record<string, string> = {
  learner_not_assigned: 'Этот ученик больше не привязан к вам.',
  tariff_not_active: 'Тариф не активен.',
  tariff_not_owned: 'Тариф вам не принадлежит.',
  tariff_duration_mismatch: 'Длительность не совпадает с тарифом.',
  in_past: 'Нельзя назначить занятие в прошлом.',
  start_out_of_band: 'Время вне рабочих часов (06:00–22:00 МСК).',
  start_not_30min_aligned: 'Время должно быть кратно 30 минутам.',
  self_booking_blocked: 'Нельзя назначить занятие себе.',
  slot_collision: 'На это время у вас уже есть занятие.',
  external_conflict: 'На это время — внешняя метка занятости в Google Calendar.',
  no_package_no_postpaid:
    'У ученика нет активного пакета и не разрешён постоплат. Назначьте оплату.',
  pending_package_grant:
    'У ученика есть оплачиваемый пакет — дождитесь его выдачи.',
  payment_method_not_set:
    'Выберите способ оплаты для этого ученика в карточке ученика.',
  no_eligible_package:
    'Подходящего пакета нет (другая длительность, закончились занятия или истёк). Выберите счёт.',
}

export function AssignDirectModal({
  tariffs,
  teacherTz = 'Europe/Moscow',
  open,
  onClose,
  onCreated,
  onSwitchToBulk,
}: {
  tariffs: ReadonlyArray<AssignTariffOption>
  teacherTz?: string
  open: boolean
  onClose: () => void
  onCreated?: (info: { emailSkipped: boolean }) => void
  /** epic-b polish (2026-06-11): user-flip to «Серия» mode → parent
   * closes this и открывает BulkAssignDirectModal. Симметрично
   * onSwitchToSingle в bulk-модалке. */
  onSwitchToBulk?: () => void
}) {
  const [learners, setLearners] = useState<LearnerListResponse['items']>([])
  const [learnersLoading, setLearnersLoading] = useState(false)
  const [learnerId, setLearnerId] = useState<string | null>(null)
  const [date, setDate] = useState(() => todayYmd())
  const [from, setFrom] = useState('10:00')
  const [tariffId, setTariffId] = useState<string>(
    tariffs[0]?.id ?? '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // epic-b Sub-PR B.2 (2026-06-11): payment-choice state.
  const [billingState, setBillingState] = useState<BillingStateResponse | null>(
    null,
  )
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingChoice, setBillingChoice] = useState<'package' | 'postpaid'>(
    'postpaid',
  )
  const [packagePurchaseId, setPackagePurchaseId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLearnersLoading(true)
    fetch('/api/teacher/learners/list-for-assign', {
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((body: LearnerListResponse) => {
        if (cancelled) return
        setLearners(Array.isArray(body.items) ? body.items : [])
      })
      .catch(() => {
        if (cancelled) return
        setError('Не удалось загрузить список учеников.')
      })
      .finally(() => {
        if (!cancelled) setLearnersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset form on close so re-open показывает чистое состояние.
  useEffect(() => {
    if (!open) {
      setError(null)
      setSubmitting(false)
      setBillingState(null)
      setPackagePurchaseId(null)
      setBillingChoice('postpaid')
    }
  }, [open])

  // epic-b Sub-PR B.2 (2026-06-11): fetch per-pair billing state when
  // learner changes. Drives the payment-choice radio (package vs
  // postpaid) and the matching-packages dropdown. Cancels in-flight
  // requests when learner switches mid-flight to avoid stale state.
  useEffect(() => {
    if (!open || !learnerId) {
      setBillingState(null)
      setPackagePurchaseId(null)
      return
    }
    let cancelled = false
    setBillingLoading(true)
    setBillingState(null)
    setPackagePurchaseId(null)
    fetch(`/api/teacher/learners/${learnerId}/billing-state`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: BillingStateResponse | null) => {
        if (cancelled) return
        if (!body) {
          setBillingState(null)
          return
        }
        setBillingState(body)
      })
      .catch(() => {
        if (cancelled) return
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, learnerId])

  const learnerOptions: ComboboxOption[] = useMemo(
    () =>
      learners.map((l) => ({
        value: l.learnerId,
        label: formatLearnerLabel(l),
        sub: l.paymentMethod === 'none' ? 'Оплата не выбрана' : undefined,
      })),
    [learners],
  )

  const tariffOptions: ComboboxOption[] = useMemo(
    () =>
      tariffs.map((t) => ({
        value: t.id,
        label: t.titleRu,
        sub:
          t.durationMinutes != null
            ? `${t.durationMinutes} мин · ${Math.round(t.amountKopecks / 100)}\u00A0₽`
            : `${Math.round(t.amountKopecks / 100)}\u00A0₽`,
      })),
    [tariffs],
  )

  const selectedTariff = tariffs.find((t) => t.id === tariffId)
  const durationMinutes = selectedTariff?.durationMinutes ?? 60

  // epic-b Sub-PR B.2 (2026-06-11): packages that match the selected
  // tariff's duration. Backend re-validates duration + ownership +
  // remaining, so this is a UX filter, not a security gate.
  const matchingPackages = useMemo(
    () =>
      (billingState?.activePackages ?? []).filter(
        (p) => p.durationMinutes === durationMinutes,
      ),
    [billingState, durationMinutes],
  )

  // Auto-select the first matching package when learner+tariff change.
  // Defaults billingChoice to 'package' if any are available — teacher's
  // most common path. Otherwise 'postpaid'.
  useEffect(() => {
    if (matchingPackages.length === 0) {
      setBillingChoice('postpaid')
      setPackagePurchaseId(null)
      return
    }
    setBillingChoice('package')
    setPackagePurchaseId((prev) => prev ?? matchingPackages[0].id)
  }, [matchingPackages])

  const packageOptions: ComboboxOption[] = useMemo(
    () =>
      matchingPackages.map((p) => ({
        value: p.id,
        label: p.titleRu,
        sub: `${p.countRemaining} осталось · до ${new Date(p.expiresAt)
          .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`,
      })),
    [matchingPackages],
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!learnerId) {
      setError('Выберите ученика.')
      return
    }
    if (!tariffId) {
      setError('Выберите тариф.')
      return
    }
    const startAtIso = isoLocalToUtcIso(date, from, teacherTz)
    if (!startAtIso) {
      setError('Не удалось вычислить время.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/teacher/slots/assign-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
          startAt: startAtIso,
          durationMinutes,
          tariffId,
          // epic-b Sub-PR B.2 (2026-06-11): explicit billing choice.
          billingChoice,
          ...(billingChoice === 'package' && packagePurchaseId
            ? { packagePurchaseId }
            : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = String(body?.error ?? '')
        setError(REASON_COPY[code] ?? `Не удалось назначить (HTTP ${res.status}).`)
        setSubmitting(false)
        return
      }
      onCreated?.({ emailSkipped: Boolean(body?.emailSkipped) })
      onClose()
    } catch (err) {
      setError(
        `Сеть недоступна: ${err instanceof Error ? err.message : String(err)}`,
      )
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Назначить занятие ученику"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '20px',
          color: 'var(--text)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <header style={{ marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
            Назначить занятие
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '13px',
              color: 'var(--text-secondary)',
            }}
          >
            Время фиксируется сразу как занятое; ученик получит письмо.
          </p>
        </header>

        {onSwitchToBulk ? (
          <div style={{ marginBottom: 12 }}>
            <ChipGroup
              name="assign-mode"
              value="single"
              options={MODE_OPTIONS}
              onChange={(next) => {
                if (next === 'bulk') onSwitchToBulk()
              }}
            />
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Ученик
            </label>
            <Combobox
              value={learnerId}
              onChange={(v) => setLearnerId(v)}
              options={learnerOptions}
              placeholder={
                learnersLoading ? 'Загрузка…' : 'Выберите ученика'
              }
              loading={learnersLoading}
              emptyMessage="Нет привязанных учеников"
              disabled={submitting}
              size="md"
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label
              htmlFor="assign-direct-date"
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Дата
            </label>
            <DatePicker
              value={date}
              onChange={setDate}
              min={todayYmd()}
              disabled={submitting}
              ariaLabel="Дата занятия"
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Время начала
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TimePicker
                value={from}
                onChange={setFrom}
                hourMin={6}
                hourMax={21}
                granularity={1}
                disabled={submitting}
                ariaLabel="Время начала"
              />
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                }}
              >
                {durationMinutes}&nbsp;мин (из тарифа)
              </span>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Тариф
            </label>
            <Combobox
              value={tariffId}
              onChange={(v) => setTariffId(v)}
              options={tariffOptions}
              placeholder="Выберите тариф"
              emptyMessage="Нет активных тарифов"
              disabled={submitting}
              size="md"
              searchable={false}
            />
          </div>

          {/* epic-b Sub-PR B.2 (2026-06-11): payment-choice selector.
              Two paths: списать с пакета (если есть подходящие по
              длительности) или счёт после (postpaid). Default — пакет,
              если он есть; иначе — счёт. */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Способ оплаты
            </label>
            {learnerId == null ? (
              <p
                style={{
                  margin: 0,
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                }}
              >
                Выберите ученика выше.
              </p>
            ) : billingLoading ? (
              <p
                style={{
                  margin: 0,
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                }}
              >
                Загрузка…
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Способ оплаты"
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: 10,
                    borderRadius: 8,
                    cursor:
                      matchingPackages.length === 0 || submitting
                        ? 'not-allowed'
                        : 'pointer',
                    background:
                      billingChoice === 'package'
                        ? 'var(--accent-bg)'
                        : 'transparent',
                    border:
                      billingChoice === 'package'
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border)',
                    opacity: matchingPackages.length === 0 ? 0.5 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="billing-choice"
                    checked={billingChoice === 'package'}
                    onChange={() => setBillingChoice('package')}
                    disabled={
                      matchingPackages.length === 0 || submitting
                    }
                    style={{ marginTop: 3 }}
                  />
                  <span
                    style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                  >
                    <strong style={{ fontSize: 14 }}>
                      Списать с пакета
                    </strong>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {matchingPackages.length === 0
                        ? `Нет пакетов на ${durationMinutes}\u00A0мин.`
                        : `${matchingPackages.length} пакет(ов) подходящей длительности.`}
                    </span>
                    {billingChoice === 'package' && matchingPackages.length > 0 ? (
                      <div style={{ marginTop: 8 }}>
                        <Combobox
                          value={packagePurchaseId}
                          onChange={(v) => setPackagePurchaseId(v)}
                          options={packageOptions}
                          placeholder="Выберите пакет"
                          emptyMessage="Нет подходящих пакетов"
                          disabled={submitting}
                          size="sm"
                          searchable={false}
                        />
                      </div>
                    ) : null}
                  </span>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: 10,
                    borderRadius: 8,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    background:
                      billingChoice === 'postpaid'
                        ? 'var(--accent-bg)'
                        : 'transparent',
                    border:
                      billingChoice === 'postpaid'
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border)',
                  }}
                >
                  <input
                    type="radio"
                    name="billing-choice"
                    checked={billingChoice === 'postpaid'}
                    onChange={() => setBillingChoice('postpaid')}
                    disabled={submitting}
                    style={{ marginTop: 3 }}
                  />
                  <span
                    style={{ display: 'flex', flexDirection: 'column' }}
                  >
                    <strong style={{ fontSize: 14 }}>Счёт после</strong>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      Долг копится, вы периодически выставляете счёт за пределами платформы.
                    </span>
                  </span>
                </label>
                {billingState && billingState.paymentMethod === 'none' ? (
                  <p
                    role="alert"
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: 'var(--secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    У ученика не выбран способ оплаты — занятие будет назначено,
                    но «счёт после» не сработает до выбора метода в карточке ученика.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {error ? (
            <div
              role="alert"
              style={{
                marginBottom: '12px',
                padding: '10px 12px',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                border: '1px solid var(--danger)',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              gap: '8px',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting || !learnerId || !tariffId}
              style={{
                padding: '10px 16px',
                background: 'var(--accent)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor:
                  submitting || !learnerId || !tariffId
                    ? 'not-allowed'
                    : 'pointer',
                opacity: submitting || !learnerId || !tariffId ? 0.6 : 1,
              }}
            >
              {submitting ? 'Создаём…' : 'Назначить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
