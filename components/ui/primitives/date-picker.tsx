'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

// LevelChannel date picker — design-system primitive.
//
// minute-start epic Sub-PR A.2 (2026-06-11): заменяет HTML5
// <input type="date"> во всех модалках. Mobile = bottom-sheet
// с calendar grid (month view). Desktop = inline dropdown под trigger.
//
// Контракт:
//   - value: 'YYYY-MM-DD' string или null.
//   - onChange: (next: 'YYYY-MM-DD') => void.
//   - min/max: optional bounds (inclusive). Default min = today.
//
// A11y: trigger — button с aria-label; selected cell — aria-pressed;
// roving tabindex для arrow keyboard nav.

export type DatePickerProps = {
  value: string | null
  onChange: (next: string) => void
  min?: string
  max?: string
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(s: string | null): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function todayYmd(): string {
  return ymd(new Date())
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(1)
  r.setMonth(r.getMonth() + n)
  return r
}

const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Выберите дату',
  disabled,
  ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const effectiveMin = useMemo(() => min ?? todayYmd(), [min])

  const selected = parseYmd(value)
  const initialMonth = selected ?? parseYmd(effectiveMin) ?? new Date()
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date(initialMonth)
    d.setDate(1)
    return d
  })

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Click outside to close.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        sheetRef.current && !sheetRef.current.contains(t)
        && triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const triggerLabel = useMemo(() => {
    if (!selected) return placeholder
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(selected)
  }, [selected, placeholder])

  const handleSelect = useCallback(
    (d: Date) => {
      onChange(ymd(d))
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange],
  )

  const cells = useMemo(() => {
    const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const lastDay = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 1,
      0,
    )
    // Monday as first day (Russian convention). getDay: 0=Sun..6=Sat → map to Mon=0..Sun=6.
    const firstDow = (firstDay.getDay() + 6) % 7
    const total = lastDay.getDate()
    const cells: Array<{ date: Date; current: boolean } | null> = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= total; d++) {
      cells.push({
        date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d),
        current: true,
      })
    }
    return cells
  }, [viewMonth])

  const minDate = parseYmd(effectiveMin)
  const maxDate = max ? parseYmd(max) : null

  function isDisabled(d: Date): boolean {
    if (minDate && d.getTime() < minDate.getTime()) return true
    if (maxDate && d.getTime() > maxDate.getTime()) return true
    return false
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-sheet`}
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '10px 14px',
          textAlign: 'left',
          background: 'var(--surface-2)',
          color: selected ? 'var(--text)' : 'var(--text-tertiary, var(--secondary))',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 15,
          fontVariantNumeric: 'tabular-nums',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          ref={sheetRef}
          id={`${id}-sheet`}
          role="dialog"
          aria-modal="false"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 1200,
            width: 'min(320px, 90vw)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setViewMonth((v) => addMonths(v, -1))}
              aria-label="Предыдущий месяц"
              style={navBtnStyle}
            >
              ‹
            </button>
            <span
              aria-live="polite"
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}
            >
              {MONTH_LABELS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((v) => addMonths(v, 1))}
              aria-label="Следующий месяц"
              style={navBtnStyle}
            >
              ›
            </button>
          </header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 2,
              fontSize: 12,
              color: 'var(--text-secondary, var(--secondary))',
              marginBottom: 4,
            }}
          >
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                style={{ textAlign: 'center', padding: '4px 0' }}
              >
                {w}
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 2,
            }}
            role="grid"
          >
            {cells.map((c, i) => {
              if (!c) return <div key={`spacer-${i}`} />
              const dYmd = ymd(c.date)
              const sel = selected && ymd(selected) === dYmd
              const today = todayYmd() === dYmd
              const disabledCell = isDisabled(c.date)
              return (
                <button
                  key={dYmd}
                  type="button"
                  role="gridcell"
                  aria-pressed={Boolean(sel)}
                  aria-label={c.date.toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                  })}
                  onClick={() => !disabledCell && handleSelect(c.date)}
                  disabled={disabledCell}
                  style={{
                    aspectRatio: '1 / 1',
                    minWidth: 32,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel
                      ? 'var(--text-on-accent, #fff)'
                      : disabledCell
                        ? 'var(--text-tertiary)'
                        : 'var(--text)',
                    border: today && !sel
                      ? '1px solid var(--accent)'
                      : '1px solid transparent',
                    borderRadius: 6,
                    fontSize: 13,
                    fontVariantNumeric: 'tabular-nums',
                    cursor: disabledCell ? 'not-allowed' : 'pointer',
                    opacity: disabledCell ? 0.4 : 1,
                  }}
                >
                  {c.date.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 18,
  cursor: 'pointer',
}
