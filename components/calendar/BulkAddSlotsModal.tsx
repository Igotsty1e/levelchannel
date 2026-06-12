'use client'

import { CSSProperties, FormEvent, useEffect, useState } from 'react'

import { ChipGroup, DatePicker } from '@/components/ui/primitives'

import { TimeRangeRow } from './TimeRangeRow'

type Tariff = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

const MODE_OPTIONS = [
  { value: 'single', label: 'Один слот' },
  { value: 'bulk', label: 'Несколько слотов' },
] as const

const BULK_PREF_KEY = 'lc_calendar_create_bulk_mode'

const DAYS_OF_WEEK: Array<{ value: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
]

function todayYmd(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function ymdPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtTimeRu(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' })} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}`
}

type PreviewResponse = {
  willCreate: Array<{ startUtcIso: string; durationMinutes: number }>
  skippedReasons: Array<{ startUtcIso: string; reason: string }>
  conflicts: Array<{ startUtcIso: string }>
  truncatedAt200?: boolean
}

export function BulkAddSlotsModal({
  open,
  onClose,
  onCreated,
  onSwitchToSingle,
  tariffs,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /**
   * Called when the user flips the segmented switcher back to «Один
   * слот». Parent closes this modal and opens MobileCreateFab sheet in
   * single mode.
   */
  onSwitchToSingle?: () => void
  tariffs: ReadonlyArray<Tariff>
}) {
  const [startDate, setStartDate] = useState(todayYmd())
  const [endDate, setEndDate] = useState(ymdPlus(28))
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(new Set([2, 4]))
  const [times, setTimes] = useState<string[]>(['18:00'])
  const [tariffId, setTariffId] = useState<string>(tariffs[0]?.id ?? '')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Single duration shared across all rows in this batch — matches the
  // tariff invariant in `assertTariffDurationMatches`. Editing the
  // «До» chip in any TimeRangeRow updates this state.
  const [durationMinutes, setDurationMinutes] = useState(60)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setErr(null)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
    // Default the new «От» to (last «От» + durationMinutes) so the
    // user can stack intervals back-to-back. If the result lands past
    // 22:00 we wrap back to 18:00.
    const last = times[times.length - 1] ?? '18:00'
    const [hh, mm] = last.split(':').map(Number)
    const lastMin = (Number.isInteger(hh) ? hh : 18) * 60 + (Number.isInteger(mm) ? mm : 0)
    const nextMin = lastMin + durationMinutes
    let next: string
    if (nextMin + durationMinutes > 22 * 60) {
      next = '18:00'
    } else {
      const nh = Math.floor(nextMin / 60)
      const nm = nextMin % 60
      next = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
    }
    setTimes([...times, next])
  }

  async function runPreview() {
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
    if (preview.willCreate.length > 200) {
      setErr('Слишком много слотов: уменьшите диапазон или число времён.')
      return
    }
    setCreating(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMinutes,
          tariffId: tariffId || null,
          slots: preview.willCreate.map((s) => ({ startAt: s.startUtcIso })),
        }),
      })
      const body = (await res.json()) as { created?: unknown[]; error?: string }
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`)
        return
      }
      onCreated()
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
      aria-label="Добавить слоты массово"
      style={overlayStyle}
      onClick={onClose}
    >
      <div
        className="bulk-add-sheet"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Добавить слоты</h2>
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
            name="create-mode"
            value="bulk"
            options={MODE_OPTIONS}
            onChange={(next) => {
              if (next === 'single' && onSwitchToSingle) {
                try {
                  if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(BULK_PREF_KEY)
                  }
                } catch {
                  // ignore
                }
                onSwitchToSingle()
              }
            }}
          />
        </div>

        <form onSubmit={runCreate} style={bodyStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <legend style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 6 }}>
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
                      border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
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
            <div style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 6 }}>
              Интервалы (МСК, шаг 30 мин)
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

          <label style={{ ...fieldStyle, marginTop: 12 }}>
            Тариф
            <select
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
              style={inputStyle}
            >
              {tariffs.length === 0 ? (
                <option value="">— нет тарифов —</option>
              ) : null}
              {tariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.titleRu} ({Math.round(t.amountKopecks / 100)} ₽)
                </option>
              ))}
            </select>
          </label>

          {err ? (
            <div role="alert" style={errorStyle}>
              {err}
            </div>
          ) : null}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={runPreview}
              disabled={previewing}
              style={previewBtnStyle}
            >
              {previewing ? 'Считаем…' : 'Предпросмотр'}
            </button>
            <button
              type="submit"
              disabled={
                creating || !preview || preview.willCreate.length === 0
              }
              style={submitBtnStyle}
            >
              {creating
                ? 'Создаём…'
                : preview
                  ? `Создать ${preview.willCreate.length} слотов`
                  : 'Создать'}
            </button>
          </div>

          {preview ? (
            <div role="status" style={previewBoxStyle}>
              <div style={{ marginBottom: 6 }}>
                Будет создано: <strong>{preview.willCreate.length}</strong>
              </div>
              {preview.conflicts.length > 0 ? (
                <div style={{ color: 'var(--warning, #f5c26b)', marginBottom: 6 }}>
                  Пропущено по конфликтам: {preview.conflicts.length}
                </div>
              ) : null}
              {preview.skippedReasons.length > 0 ? (
                <div style={{ color: 'var(--secondary)', marginBottom: 6 }}>
                  Вне рабочих часов / не выровнено: {preview.skippedReasons.length}
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
              {preview.truncatedAt200 ? (
                <div style={{ color: 'var(--danger)', marginTop: 8 }}>
                  Слишком много слотов (200+). Уменьшите диапазон или число времён.
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--secondary)' }}>
              Сначала нажмите «Предпросмотр», чтобы увидеть, какие слоты будут созданы
              и какие пропустим из-за конфликтов или нерабочих часов.
            </p>
          )}
        </form>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .bulk-add-sheet {
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

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
}

const removeBtnStyle: CSSProperties = {
  width: 36,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  borderRadius: 6,
  cursor: 'pointer',
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
