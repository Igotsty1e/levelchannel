'use client'

import { useState } from 'react'

import {
  Button,
  ChipGroup,
  FloatingActionButton,
} from '@/components/ui/primitives'

// Mobile entry-point for slot creation. Drag-paint is unusable on phone;
// this gives the tutor a form path that POSTs the same endpoint as the
// desktop paint flow (`/api/teacher/slots/bulk-create` with a single
// startAt).
//
// Visibility: the FAB itself is hidden on ≥600px via the
// `.calendar-mobile-fab` class (rule lives in app/globals.css). The
// modal is rendered regardless of width — when invoked it covers the
// screen on any viewport. Today desktop uses drag-paint; if we ever
// want a form path there too, this component is the seed.

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

const DURATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '30', label: '30 мин' },
  { value: '60', label: '60 мин' },
  { value: '90', label: '90 мин' },
  { value: '120', label: '120 мин' },
]

function isoLocalToUtcIso(dateYmd: string, hhmm: string, ianaTz: string): string | null {
  // `dateYmd` = 'YYYY-MM-DD', `hhmm` = 'HH:mm' — interpreted in `ianaTz`.
  // We don't have a TZ-aware parser in the browser; compute the UTC
  // offset via the round-trip trick (Intl.DateTimeFormat → parts).
  // Cheap and accurate to the minute, which is what the half-hour
  // grid demands anyway.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd)
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m || !t) return null
  const [, y, mo, d] = m
  const [, hh, mm] = t
  const yi = Number(y)
  const moi = Number(mo)
  const di = Number(d)
  const hi = Number(hh)
  const mi = Number(mm)
  // Naive UTC interpretation of the local wall-clock.
  const naiveUtc = Date.UTC(yi, moi - 1, di, hi, mi, 0)
  // Re-format that instant back through the target tz; compute the
  // diff between what we asked for and what comes out, and shift.
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

export function MobileCreateFab({
  tariffs,
  teacherTz = 'Europe/Moscow',
  onCreated,
  onSwitchToBulk,
}: {
  tariffs: ReadonlyArray<TariffOption>
  teacherTz?: string
  onCreated?: () => void
  /**
   * Called when the user flips the «Создавать несколько слотов»
   * checkbox inside the FAB sheet. Parent should close this modal
   * (handled here via setOpen(false)) AND open BulkAddSlotsModal.
   */
  onSwitchToBulk?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => todayInTz(teacherTz))
  const [time, setTime] = useState('10:00')
  const [duration, setDuration] = useState<string>('60')
  const [tariffId, setTariffId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const BULK_PREF_KEY = 'lc_calendar_create_bulk_mode'

  function openFab() {
    // If user previously toggled bulk-mode ON, route directly to bulk
    // without flashing the single-form sheet.
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(BULK_PREF_KEY) === '1') {
        onSwitchToBulk?.()
        return
      }
    } catch {
      // ignore localStorage errors (private mode, etc.)
    }
    setOpen(true)
  }

  function switchToBulk() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(BULK_PREF_KEY, '1')
      }
    } catch {
      // ignore
    }
    setOpen(false)
    onSwitchToBulk?.()
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const startIso = isoLocalToUtcIso(date, time, teacherTz)
      if (!startIso) {
        setError('Не получилось разобрать дату или время.')
        setBusy(false)
        return
      }
      const res = await fetch('/api/teacher/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMinutes: Number(duration),
          tariffId: tariffId || null,
          slots: [{ startAt: startIso }],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      setOpen(false)
      onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="calendar-mobile-fab">
        <FloatingActionButton label="Создать" onClick={openFab} />
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-create-title"
          onClick={busy ? undefined : () => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--surface-1, #141416)',
              border: '1px solid var(--border)',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
              color: 'var(--text)',
              boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 40,
                height: 4,
                borderRadius: 999,
                background: 'var(--border)',
                margin: '0 auto 16px',
              }}
            />
            <h2 id="mobile-create-title" style={{ fontSize: 17, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
              Новое занятие
            </h2>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                marginBottom: 16,
                padding: '10px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={false}
                onChange={(e) => {
                  if (e.target.checked) switchToBulk()
                }}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
              <span>Создавать несколько слотов</span>
            </label>

            <FieldLabel htmlFor="mcf-date">Дата</FieldLabel>
            <input
              id="mcf-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />

            <FieldLabel htmlFor="mcf-time" style={{ marginTop: 14 }}>Время начала</FieldLabel>
            <input
              id="mcf-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              step={1800}
              style={inputStyle}
            />

            <FieldLabel style={{ marginTop: 14 }}>Длительность</FieldLabel>
            <ChipGroup
              name="duration"
              value={duration}
              options={DURATIONS}
              onChange={setDuration}
            />

            <FieldLabel style={{ marginTop: 14 }}>Тариф</FieldLabel>
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

            {error ? (
              <div
                role="alert"
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Отмена
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={handleSubmit}
                loading={busy}
              >
                Создать
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function FieldLabel({
  htmlFor,
  children,
  style,
}: {
  htmlFor?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontSize: 12,
        color: 'var(--secondary)',
        marginBottom: 6,
        ...style,
      }}
    >
      {children}
    </label>
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
