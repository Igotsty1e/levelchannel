'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

import { Combobox, type ComboboxOption } from '@/components/ui/primitives'

import { TimePickerButton } from './TimePickerButton'

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
    paymentMethod: 'postpaid' | 'prepaid_packages' | 'none'
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
}

export function AssignDirectModal({
  tariffs,
  teacherTz = 'Europe/Moscow',
  open,
  onClose,
  onCreated,
}: {
  tariffs: ReadonlyArray<AssignTariffOption>
  teacherTz?: string
  open: boolean
  onClose: () => void
  onCreated?: (info: { emailSkipped: boolean }) => void
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
    }
  }, [open])

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
            <input
              id="assign-direct-date"
              type="date"
              value={date}
              min={todayYmd()}
              onChange={(e) => setDate(e.target.value)}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '15px',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}
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
              <TimePickerButton
                label="От"
                value={from}
                onSelect={setFrom}
                disabled={submitting}
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

          <div style={{ marginBottom: '16px' }}>
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
