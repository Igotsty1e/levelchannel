'use client'

import { useState } from 'react'

import { Button, ChipGroup } from '@/components/ui/primitives'

import { TimeRangeRow } from './TimeRangeRow'

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

function todayInTz(ianaTz: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: ianaTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return dtf.format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function isoLocalToUtcIso(dateYmd: string, hhmm: string, ianaTz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd)
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m || !t) return null
  const [, y, mo, d] = m
  const [, hh, mm] = t
  const naiveUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), 0)
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
    return new Date(naiveUtc + (naiveUtc - gotUtc)).toISOString()
  } catch {
    return null
  }
}

export function SingleSlotForm({
  tariffs,
  teacherTz = 'Europe/Moscow',
  onCancel,
  onCreated,
}: {
  tariffs: ReadonlyArray<TariffOption>
  teacherTz?: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [date, setDate] = useState(() => todayInTz(teacherTz))
  const [from, setFrom] = useState('10:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [tariffId, setTariffId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const startIso = isoLocalToUtcIso(date, from, teacherTz)
      if (!startIso) {
        setError('Не получилось разобрать дату или время.')
        return
      }
      const res = await fetch('/api/teacher/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMinutes,
          tariffId: tariffId || null,
          slots: [{ startAt: startIso }],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Дата">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Интервал">
        <TimeRangeRow
          from={from}
          durationMinutes={durationMinutes}
          onFromChange={setFrom}
          onDurationChange={setDurationMinutes}
        />
      </Field>

      <Field label="Тариф">
        {tariffs.length <= 3 ? (
          <ChipGroup
            name="tariff"
            value={tariffId}
            options={[
              { value: '', label: 'Без цены' },
              ...tariffs.map((t) => ({
                value: t.id,
                label: `${t.titleRu} · ${(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽`,
              })),
            ]}
            onChange={setTariffId}
          />
        ) : (
          <select
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Без цены</option>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.titleRu} · {(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽
              </option>
            ))}
          </select>
        )}
      </Field>

      {error ? (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="secondary" fullWidth onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button variant="primary" fullWidth onClick={handleSubmit} loading={busy}>
          Создать
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          display: 'block',
          fontSize: 12,
          color: 'var(--secondary)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
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
