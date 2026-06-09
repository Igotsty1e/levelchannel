'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/primitives'

import { TimeRangeRow } from './TimeRangeRow'

type Tariff = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

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
  return new Date().toISOString().slice(0, 10)
}

function ymdPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minToHhmm(min: number): string {
  const hh = Math.floor(min / 60) % 24
  const mm = ((min % 60) + 60) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

type PreviewResponse = {
  willCreate: Array<{ startUtcIso: string; durationMinutes: number }>
  skippedReasons: Array<{ startUtcIso: string; reason: string }>
  conflicts: Array<{ startUtcIso: string }>
  truncatedAt200?: boolean
}

export function BulkSlotsForm({
  tariffs,
  onCancel,
  onCreated,
}: {
  tariffs: ReadonlyArray<Tariff>
  onCancel: () => void
  onCreated: () => void
}) {
  const [startDate, setStartDate] = useState(todayYmd())
  const [endDate, setEndDate] = useState(ymdPlus(28))
  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(new Set([2, 4]))
  const [froms, setFroms] = useState<string[]>(['18:00'])
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [tariffId, setTariffId] = useState<string>(tariffs[0]?.id ?? '')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // When the duration changes anywhere, all rows reflect it through
  // their derived «До» — but we also expose each row's «До» as
  // editable. Editing one row's «До» updates the shared duration
  // (per the tariff invariant in `assertTariffDurationMatches`).
  const intervals = useMemo(
    () =>
      froms.map((from) => ({
        from,
        to: minToHhmm(hhmmToMin(from) + durationMinutes),
      })),
    [froms, durationMinutes],
  )

  useEffect(() => {
    setPreview(null)
    setErr(null)
  }, [startDate, endDate, daysOfWeek, froms, durationMinutes])

  function toggleDay(v: number) {
    const next = new Set(daysOfWeek)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setDaysOfWeek(next)
  }

  function updateFrom(idx: number, value: string) {
    setFroms(froms.map((t, i) => (i === idx ? value : t)))
  }
  function removeRow(idx: number) {
    setFroms(froms.filter((_, i) => i !== idx))
  }
  function addRow() {
    setFroms([...froms, minToHhmm(hhmmToMin(froms[froms.length - 1] ?? '18:00') + 60)])
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
          intervals,
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create_failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={runCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Дата начала">
          <input
            type="date"
            value={startDate}
            min={todayYmd()}
            onChange={(e) => setStartDate(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Дата окончания">
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={ymdPlus(90)}
            onChange={(e) => setEndDate(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <div>
        <div style={legendStyle}>Дни недели</div>
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
      </div>

      <div>
        <div style={legendStyle}>Интервалы</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {froms.map((from, idx) => (
            <TimeRangeRow
              key={idx}
              from={from}
              durationMinutes={durationMinutes}
              onFromChange={(next) => updateFrom(idx, next)}
              onDurationChange={(nextDur) => setDurationMinutes(nextDur)}
              allowRemove={froms.length > 1}
              onRemove={() => removeRow(idx)}
            />
          ))}
          <button
            type="button"
            onClick={addRow}
            style={{
              padding: '10px 12px',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + Ещё интервал
          </button>
        </div>
      </div>

      <Field label="Тариф">
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
      </Field>

      {err ? (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      ) : null}

      {preview ? (
        <div style={previewBoxStyle}>
          <strong style={{ fontSize: 13 }}>
            Создастся: {preview.willCreate.length}
          </strong>
          {preview.skippedReasons.length > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
              {' '}
              · пропущено: {preview.skippedReasons.length}
            </span>
          ) : null}
          {preview.conflicts.length > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
              {' '}
              · конфликты: {preview.conflicts.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          fullWidth
          onClick={onCancel}
          disabled={previewing || creating}
        >
          Отмена
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={runPreview}
          disabled={previewing}
        >
          {previewing ? 'Считаем…' : 'Предпросмотр'}
        </Button>
        <Button
          variant="primary"
          fullWidth
          type="submit"
          disabled={creating || !preview || preview.willCreate.length === 0}
          loading={creating}
        >
          {preview ? `Создать ${preview.willCreate.length}` : 'Создать'}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={legendStyle}>{label}</span>
      {children}
    </label>
  )
}

const legendStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--secondary)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--surface-2, rgba(255,255,255,0.05))',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
  colorScheme: 'dark',
}

const errorStyle: React.CSSProperties = {
  padding: 12,
  background: 'var(--danger-bg, rgba(248,113,113,0.08))',
  border: '1px solid var(--danger, rgba(248,113,113,0.4))',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
}

const previewBoxStyle: React.CSSProperties = {
  padding: 10,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
}
