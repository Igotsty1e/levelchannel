'use client'

import { CSSProperties, useEffect, useMemo, useState } from 'react'

import {
  ChipGroup,
  Combobox,
  type ComboboxOption,
  DatePicker,
  FloatingActionButton,
  TimePicker,
} from '@/components/ui/primitives'
import type { CalendarSlotMode } from '@/lib/scheduling/slot-mode'


// Single-slot entry-point. The FAB itself is hidden on ≥600px via
// `.calendar-mobile-fab` (rule in app/globals.css). The modal that
// opens visually matches `BulkAddSlotsModal` — same centered chrome,
// same `Добавить слоты`-style header + segmented switcher. Only the
// body differs: one date input + one `TimeRangeRow` + tariff picker
// + cancel/submit. Switching the segmented to «Несколько слотов»
// closes this sheet and opens the bulk modal (parent owns mode).

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
  durationMinutes?: number
}

// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11) — добавили
// третий режим 'assign' для прямого назначения занятия ученику.
// epic-b Sub-PR B.3 (2026-06-11, epic-close) — четвёртый режим
// 'bulk_assign' для назначения сразу N занятий одному ученику.
export type CreateMode = 'closed' | 'single' | 'bulk' | 'assign' | 'bulk_assign'

const BULK_PREF_KEY = 'lc_calendar_create_bulk_mode'

// epic-b polish (2026-06-11): chip group ВНУТРИ open-slot модалки
// переключает только между «Один слот» / «Несколько» — это open-slot
// контур. «Назначить ученику» это РАЗНЫЙ flow (direct-assign), ему
// тут не место. Доступ к нему — через top-level кнопку на /teacher/calendar.
const MODE_OPTIONS_OPEN_SLOTS = [
  { value: 'single', label: 'Один слот' },
  { value: 'bulk', label: 'Несколько' },
] as const

// teacher-no-slots-mode (Задача 2.1, 2026-06-11): когда учитель в
// direct_assign режиме, FAB сразу открывает AssignDirectModal без чип-
// группы (см. openFromFab — он шортcut'ит сразу в 'assign'). Этот
// массив остаётся пустым placeholder'ом — рендер чип-группы пропускает
// его если length < 2.
const MODE_OPTIONS_DIRECT_ASSIGN = [] as const

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
  slotMode = 'open_slots',
}: {
  tariffs: ReadonlyArray<TariffOption>
  teacherTz?: string
  mode: CreateMode
  onModeChange: (next: CreateMode) => void
  onCreated?: () => void
  // teacher-no-slots-mode (Задача 2.1): когда 'direct_assign', single
  // и bulk опции скрыты — оставляем только Назначить ученику.
  slotMode?: CalendarSlotMode
}) {
  const modeOptions =
    slotMode === 'direct_assign'
      ? MODE_OPTIONS_DIRECT_ASSIGN
      : MODE_OPTIONS_OPEN_SLOTS
  const [date, setDate] = useState(() => todayInTz(teacherTz))
  const [from, setFrom] = useState('10:00')
  const [tariffId, setTariffId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Duration берётся из выбранного тарифа — тот же подход что в
  // AssignDirectModal. Default 60 если тариф не выбран.
  const selectedTariff = tariffs.find((t) => t.id === tariffId)
  const durationMinutes = selectedTariff?.durationMinutes ?? 60

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

  function openFromFab() {
    // teacher-no-slots-mode (Задача 2.1): в direct_assign режиме open-slot
    // опций нет — FAB сразу открывает AssignDirectModal.
    if (slotMode === 'direct_assign') {
      onModeChange('assign')
      return
    }
    let next: CreateMode = 'single'
    try {
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem(BULK_PREF_KEY) === '1'
      ) {
        next = 'bulk'
      }
    } catch {
      // ignore (private mode etc.)
    }
    onModeChange(next)
  }

  function handleModeChange(next: string) {
    if (next !== 'single' && next !== 'bulk') return
    try {
      if (typeof window !== 'undefined') {
        if (next === 'bulk') window.localStorage.setItem(BULK_PREF_KEY, '1')
        else window.localStorage.removeItem(BULK_PREF_KEY)
      }
    } catch {
      // ignore
    }
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
      <div className="calendar-mobile-fab">
        <FloatingActionButton label="Создать" onClick={openFromFab} />
      </div>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Новое занятие"
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
                Новое занятие
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
                <label style={labelStyle}>Время начала</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <TimePicker
                    value={from}
                    onChange={setFrom}
                    hourMin={6}
                    hourMax={21}
                    granularity={1}
                    ariaLabel="Время начала"
                    disabled={busy}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {durationMinutes}&nbsp;мин
                  </span>
                </div>
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
