'use client'

import { CSSProperties, useEffect, useMemo, useState } from 'react'

import {
  ChipGroup,
  Combobox,
  type ComboboxOption,
  DatePicker,
} from '@/components/ui/primitives'

import { TimeRangeRow } from './TimeRangeRow'


// Single-slot mobile sheet. 2026-06-12 teacher-calendar-unify: FAB
// убрали — sheet триггерится из top-row кнопки «+ Добавить слоты» через
// onSwitchToSingle в BulkAddSlotsModal. Внутри chip-switcher позволяет
// вернуться обратно в bulk. Визуально матчит BulkAddSlotsModal —
// same centered chrome, same header + segmented switcher.

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
  durationMinutes?: number
}

// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11) — режим
// 'assign' для прямого назначения занятия ученику. 2026-06-12 polish:
// single + series теперь живут внутри одной модалки (AssignDirectModal),
// отдельный `bulk_assign` мод убран.
export type CreateMode = 'closed' | 'single' | 'bulk' | 'assign'

const MODE_OPTIONS_OPEN_SLOTS = [
  { value: 'single', label: 'Один слот' },
  { value: 'bulk', label: 'Несколько' },
] as const

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
  mode,
  onModeChange,
  onCreated,
}: {
  tariffs: ReadonlyArray<TariffOption>
  teacherTz?: string
  mode: CreateMode
  onModeChange: (next: CreateMode) => void
  onCreated?: () => void
}) {
  const modeOptions = MODE_OPTIONS_OPEN_SLOTS
  const [date, setDate] = useState(() => todayInTz(teacherTz))
  const [from, setFrom] = useState('10:00')
  // 2026-06-12 single-slot range: длительность редактируется отдельно
  // через «До» в TimeRangeRow (как в bulk-modal). При выборе тарифа
  // подтягиваем duration из тарифа, чтобы assertTariffDurationMatches
  // на сервере не отлупил отправку. Пользователь может потом подвинуть
  // «До» — на сервере 15..180.
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [tariffId, setTariffId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTariff = tariffs.find((t) => t.id === tariffId)
  useEffect(() => {
    if (selectedTariff?.durationMinutes != null) {
      setDurationMinutes(selectedTariff.durationMinutes)
    }
  }, [selectedTariff?.durationMinutes])

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

  const isOpen = mode === 'single'

  function handleModeChange(next: string) {
    if (next !== 'single' && next !== 'bulk') return
    onModeChange(next)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen && !busy) onModeChange('closed')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, busy, onModeChange])

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const startIso = isoLocalToUtcIso(date, from, teacherTz)
      if (!startIso) {
        setError('Не получилось разобрать дату или время.')
        setBusy(false)
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
      onModeChange('closed')
      onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Новый слот"
          style={overlayStyle}
          onClick={busy ? undefined : () => onModeChange('closed')}
        >
          <div
            className="single-add-sheet"
            style={sheetStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <header style={headerStyle}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Новый слот
              </h2>
              <button
                type="button"
                onClick={() => onModeChange('closed')}
                aria-label="Закрыть"
                disabled={busy}
                style={closeBtnStyle}
              >
                ×
              </button>
            </header>

            {modeOptions.length >= 2 ? (
              <div style={{ padding: '12px 16px 0' }}>
                <ChipGroup
                  name="create-mode"
                  value="single"
                  options={modeOptions}
                  onChange={handleModeChange}
                />
              </div>
            ) : null}

            <div style={bodyStyle}>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Дата</label>
                <DatePicker
                  value={date}
                  onChange={setDate}
                  disabled={busy}
                  ariaLabel="Дата слота"
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Интервал (МСК)</label>
                <TimeRangeRow
                  from={from}
                  durationMinutes={durationMinutes}
                  onFromChange={setFrom}
                  onDurationChange={setDurationMinutes}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Тариф</label>
                <Combobox
                  value={tariffId || null}
                  onChange={(v) => setTariffId(v ?? '')}
                  options={tariffOptions}
                  placeholder="Без цены"
                  emptyMessage="Нет тарифов"
                  disabled={busy}
                  size="md"
                  searchable={false}
                />
              </div>

              {error ? (
                <div role="alert" style={errorStyle}>
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
                  onClick={() => onModeChange('closed')}
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
                  {busy ? 'Создаём…' : 'Создать'}
                </button>
              </div>
            </div>
          </div>

          <style>{`
            @media (max-width: 640px) {
              .single-add-sheet {
                border-radius: 16px 16px 0 0 !important;
                margin: auto 0 0 0 !important;
                min-height: 92vh;
              }
            }
          `}</style>
        </div>
      ) : null}
    </>
  )
}

// Style mirrors BulkAddSlotsModal so the two modals are visually
// interchangeable chrome — only the body differs.

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

// DS-aligned label — копия AssignDirectModal.
const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--text-secondary)',
  marginBottom: 6,
}

const cancelBtnStyle: CSSProperties = {
  padding: '10px 16px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const submitBtnStyle: CSSProperties = {
  padding: '10px 16px',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
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
