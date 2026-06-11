'use client'

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react'

import {
  ChipGroup,
  Combobox,
  type ComboboxOption,
  DatePicker,
} from '@/components/ui/primitives'

import { TimeRangeRow } from './TimeRangeRow'

// epic-b Sub-PR B.3 (2026-06-11, epic-close). Bulk version of
// AssignDirectModal — teacher recurrence-creates N booked slots for ONE
// specific learner in a single submit. Clones BulkAddSlotsModal's
// scheduling UI + AssignDirectModal's payment-choice UI.
//
// POSTs to /api/teacher/slots/bulk-assign-direct (server iterates the
// preview's `willCreate` array → assignSlotDirect per cell).

type Tariff = {
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
    paymentMethod: 'postpaid' | 'none'
  }>
}

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

type PreviewResponse = {
  willCreate: Array<{ startUtcIso: string; durationMinutes: number }>
  skippedReasons: Array<{ startUtcIso: string; reason: string }>
  conflicts: Array<{ startUtcIso: string }>
  truncatedAt200?: boolean
}

type CreateResponse = {
  created: unknown[]
  skippedConflicts: string[]
  skippedReasons: Array<{ startAt: string; reason: string }>
  emailSkipped: boolean
  error?: string
  max?: number
}

const DAYS_OF_WEEK: Array<{
  value: 0 | 1 | 2 | 3 | 4 | 5 | 6
  label: string
}> = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
]

const MODE_OPTIONS = [
  { value: 'single', label: 'Один слот' },
  { value: 'bulk', label: 'Несколько' },
] as const

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function ymdPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtTimeRu(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' })} `
    + `${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}`
  )
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
  learner_not_assigned: 'Ученик не привязан.',
  tariff_not_active: 'Тариф не активен.',
  tariff_not_owned: 'Тариф не ваш.',
  tariff_duration_mismatch: 'Не та длительность.',
  in_past: 'В прошлом.',
  start_out_of_band: 'Вне 06–22 МСК.',
  slot_collision: 'Конфликт времени.',
  external_conflict: 'Внешняя занятость.',
  payment_method_not_set: 'Способ оплаты не выбран.',
  no_eligible_package: 'Нет подходящего пакета.',
  pending_package_grant: 'Ожидается выдача пакета.',
}

export function BulkAssignDirectModal({
  open,
  onClose,
  onCreated,
  onSwitchToSingle,
  tariffs,
}: {
  open: boolean
  onClose: () => void
  onCreated: (info: { createdCount: number; emailSkipped: boolean }) => void
  /** Called when the user flips to «Один слот» — parent closes this and opens AssignDirectModal. */
  onSwitchToSingle?: () => void
  tariffs: ReadonlyArray<Tariff>
}) {
  const [learners, setLearners] = useState<LearnerListResponse['items']>([])
  const [learnersLoading, setLearnersLoading] = useState(false)
  const [learnerId, setLearnerId] = useState<string | null>(null)

  const [startDate, setStartDate] = useState(todayYmd())
  const [endDate, setEndDate] = useState(ymdPlus(28))
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(new Set([2, 4]))
  const [times, setTimes] = useState<string[]>(['18:00'])
  const [tariffId, setTariffId] = useState<string>(tariffs[0]?.id ?? '')
  const [durationMinutes, setDurationMinutes] = useState(
    tariffs[0]?.durationMinutes ?? 60,
  )
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Payment-choice (Sub-PR B.2 surface, reused here).
  const [billingState, setBillingState] = useState<BillingStateResponse | null>(
    null,
  )
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingChoice, setBillingChoice] = useState<'package' | 'postpaid'>(
    'postpaid',
  )

  // Fetch learners list once on open.
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
      })
      .finally(() => {
        if (!cancelled) setLearnersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Sync duration with selected tariff so DB CHECK + assignSlotDirect
  // gate stay consistent.
  useEffect(() => {
    const t = tariffs.find((x) => x.id === tariffId)
    if (t?.durationMinutes != null) setDurationMinutes(t.durationMinutes)
  }, [tariffId, tariffs])

  // Per-pair billing state — drives the payment-choice radio + matching
  // packages list.
  useEffect(() => {
    if (!open || !learnerId) {
      setBillingState(null)
      return
    }
    let cancelled = false
    setBillingLoading(true)
    setBillingState(null)
    fetch(`/api/teacher/learners/${learnerId}/billing-state`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: BillingStateResponse | null) => {
        if (cancelled) return
        if (body) setBillingState(body)
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

  const matchingPackages = useMemo(
    () =>
      (billingState?.activePackages ?? []).filter(
        (p) => p.durationMinutes === durationMinutes,
      ),
    [billingState, durationMinutes],
  )

  // Default to 'package' when matching packages exist — most common
  // teacher path; otherwise 'postpaid'.
  useEffect(() => {
    if (matchingPackages.length === 0) {
      setBillingChoice('postpaid')
    } else {
      setBillingChoice('package')
    }
  }, [matchingPackages])

  // Reset preview when any input that affects expansion changes so the
  // user can't submit a stale preview.
  useEffect(() => {
    setPreview(null)
  }, [
    learnerId,
    startDate,
    endDate,
    daysOfWeek,
    times,
    tariffId,
    durationMinutes,
  ])

  useEffect(() => {
    if (!open) {
      setErr(null)
      setPreview(null)
      setCreating(false)
      setPreviewing(false)
      setLearnerId(null)
      setBillingState(null)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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

  if (!open) return null

  function toggleDay(v: number) {
    const next = new Set(daysOfWeek)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setDaysOfWeek(next)
  }

  function updateTime(idx: number, value: string) {
    setTimes(times.map((t, i) => (i === idx ? value : t)))
  }
  function removeTime(idx: number) {
    setTimes(times.filter((_, i) => i !== idx))
  }
  function addTime() {
    setTimes([...times, '18:00'])
  }

  async function runPreview() {
    if (!learnerId) {
      setErr('Выберите ученика.')
      return
    }
    setPreviewing(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/slots/preview-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          daysOfWeek: Array.from(daysOfWeek),
          times,
          durationMinutes,
        }),
      })
      const body = (await res.json()) as PreviewResponse & { error?: string }
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`)
        setPreview(null)
        return
      }
      setPreview(body)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'preview_failed')
    } finally {
      setPreviewing(false)
    }
  }

  async function runCreate(e: FormEvent) {
    e.preventDefault()
    if (!preview || preview.willCreate.length === 0) return
    if (!learnerId || !tariffId) {
      setErr('Выберите ученика и тариф.')
      return
    }
    if (preview.willCreate.length > 50) {
      setErr('Слишком много занятий за раз (макс 50). Уменьшите диапазон.')
      return
    }
    setCreating(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/slots/bulk-assign-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
          durationMinutes,
          tariffId,
          billingChoice,
          slots: preview.willCreate.map((s) => ({ startAt: s.startUtcIso })),
        }),
      })
      const body = (await res.json()) as CreateResponse
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`)
        return
      }
      onCreated({
        createdCount: body.created.length,
        emailSkipped: Boolean(body.emailSkipped),
      })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create_failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Назначить несколько занятий ученику"
      style={overlayStyle}
      onClick={onClose}
    >
      <div
        className="bulk-assign-sheet"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Назначить несколько
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={closeBtnStyle}
          >
            ×
          </button>
        </header>

        <div style={{ padding: '12px 20px 0' }}>
          <ChipGroup
            name="assign-mode"
            value="bulk"
            options={MODE_OPTIONS}
            onChange={(next) => {
              if (next === 'single' && onSwitchToSingle) onSwitchToSingle()
            }}
          />
        </div>

        <form onSubmit={runCreate} style={bodyStyle}>
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Ученик
            </div>
            <Combobox
              value={learnerId}
              onChange={(v) => setLearnerId(v)}
              options={learnerOptions}
              placeholder={learnersLoading ? 'Загрузка…' : 'Выберите ученика'}
              loading={learnersLoading}
              emptyMessage="Нет привязанных учеников"
              size="md"
            />
          </div>

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <div style={fieldStyle}>
              <span>Дата начала</span>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                min={todayYmd()}
                ariaLabel="Дата начала"
              />
            </div>
            <div style={fieldStyle}>
              <span>Дата окончания</span>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                min={startDate}
                max={ymdPlus(90)}
                ariaLabel="Дата окончания"
              />
            </div>
          </div>

          <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 0' }}>
            <legend
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Дни недели
            </legend>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS_OF_WEEK.map((d) => {
                const active = daysOfWeek.has(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    aria-pressed={active}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: active
                        ? '1px solid var(--accent)'
                        : '1px solid var(--border)',
                      background: active ? 'var(--accent)' : 'var(--bg)',
                      color: active ? '#fff' : 'var(--text)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Время начала (МСК)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {times.map((t, idx) => (
                <TimeRangeRow
                  key={idx}
                  from={t}
                  durationMinutes={durationMinutes}
                  onFromChange={(next) => updateTime(idx, next)}
                  onDurationChange={(nextDur) => setDurationMinutes(nextDur)}
                  allowRemove={times.length > 1}
                  onRemove={() => removeTime(idx)}
                />
              ))}
              <button type="button" onClick={addTime} style={addTimeBtnStyle}>
                + Ещё интервал
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Тариф
            </div>
            <Combobox
              value={tariffId}
              onChange={(v) => setTariffId(v)}
              options={tariffOptions}
              placeholder="Выберите тариф"
              emptyMessage="Нет активных тарифов"
              size="md"
              searchable={false}
            />
          </div>

          {/* Payment-choice (B.2 surface). Bulk path skips packagePurchaseId
              pinning — each iteration auto-picks the earliest matching
              package to avoid over-consume races. */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Способ оплаты
            </div>
            {!learnerId ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--secondary)' }}>
                Выберите ученика выше.
              </p>
            ) : billingLoading ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--secondary)' }}>
                Загрузка…
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Способ оплаты"
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <label style={radioLabelStyle(billingChoice === 'package')}>
                  <input
                    type="radio"
                    name="bulk-billing-choice"
                    checked={billingChoice === 'package'}
                    onChange={() => setBillingChoice('package')}
                    disabled={matchingPackages.length === 0 || creating}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: 14 }}>
                      Списать с пакета
                    </strong>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {matchingPackages.length === 0
                        ? `Нет пакетов на ${durationMinutes}\u00A0мин.`
                        : `Подходящих пакетов: ${matchingPackages.length}. Каждое занятие спишет одну единицу по очереди (ближайший истечению).`}
                    </span>
                  </span>
                </label>
                <label style={radioLabelStyle(billingChoice === 'postpaid')}>
                  <input
                    type="radio"
                    name="bulk-billing-choice"
                    checked={billingChoice === 'postpaid'}
                    onChange={() => setBillingChoice('postpaid')}
                    disabled={creating}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: 14 }}>Счёт после</strong>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      Долг копится; вы выставляете счёт за пределами платформы.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>

          {err ? (
            <div role="alert" style={errorStyle}>
              {err}
            </div>
          ) : null}

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={runPreview}
              disabled={previewing || !learnerId}
              style={previewBtnStyle}
            >
              {previewing ? 'Считаем…' : 'Предпросмотр'}
            </button>
            <button
              type="submit"
              disabled={
                creating
                || !preview
                || preview.willCreate.length === 0
                || !learnerId
                || !tariffId
              }
              style={submitBtnStyle}
            >
              {creating
                ? 'Создаём…'
                : preview
                  ? `Назначить ${preview.willCreate.length} занятий`
                  : 'Назначить'}
            </button>
          </div>

          {preview ? (
            <div role="status" style={previewBoxStyle}>
              <div style={{ marginBottom: 6 }}>
                Будет назначено: <strong>{preview.willCreate.length}</strong>
              </div>
              {preview.conflicts.length > 0 ? (
                <div
                  style={{
                    color: 'var(--warning, #f5c26b)',
                    marginBottom: 6,
                  }}
                >
                  Пропущено по конфликтам: {preview.conflicts.length}
                </div>
              ) : null}
              {preview.skippedReasons.length > 0 ? (
                <div style={{ color: 'var(--secondary)', marginBottom: 6 }}>
                  Вне рабочих часов: {preview.skippedReasons.length}
                </div>
              ) : null}
              {preview.willCreate.length > 50 ? (
                <div style={{ color: 'var(--danger)' }}>
                  Слишком много за один запрос (максимум 50). Уменьшите диапазон.
                </div>
              ) : null}
              {preview.willCreate.length > 0 ? (
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 160,
                    overflowY: 'auto',
                    fontSize: 12,
                    fontFamily: 'ui-monospace, monospace',
                    color: 'var(--secondary)',
                  }}
                >
                  {preview.willCreate.slice(0, 20).map((s) => (
                    <div key={s.startUtcIso}>· {fmtTimeRu(s.startUtcIso)}</div>
                  ))}
                  {preview.willCreate.length > 20 ? (
                    <div>… и ещё {preview.willCreate.length - 20}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p
              style={{
                marginTop: 12,
                fontSize: 12,
                color: 'var(--secondary)',
              }}
            >
              Нажмите «Предпросмотр», чтобы увидеть, какие занятия будут назначены
              и какие пропустим из-за конфликтов или нерабочих часов.
            </p>
          )}
        </form>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .bulk-assign-sheet {
            border-radius: 16px 16px 0 0 !important;
            margin: auto 0 0 0 !important;
            min-height: 92vh;
          }
        }
      `}</style>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const sheetStyle: CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  maxWidth: 520,
  width: '100%',
  maxHeight: '92vh',
  overflowY: 'auto',
  boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid var(--border)',
}

const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text)',
  fontSize: 24,
  cursor: 'pointer',
  padding: '0 8px',
}

const bodyStyle: CSSProperties = {
  padding: 16,
}

const fieldStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  display: 'grid',
  gap: 4,
}

const addTimeBtnStyle: CSSProperties = {
  border: '1px dashed var(--border)',
  background: 'transparent',
  color: 'var(--secondary)',
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 13,
  alignSelf: 'flex-start',
}

const previewBtnStyle: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}

const submitBtnStyle: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: 10,
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.4)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
}

const previewBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--text)',
}

function radioLabelStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    background: active ? 'var(--accent-bg)' : 'transparent',
    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
    cursor: 'pointer',
  }
}

void REASON_COPY
