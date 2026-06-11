'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

// LevelChannel time picker — design-system primitive.
//
// minute-start epic Sub-PR A.2 (2026-06-11): minute-precision (default
// granularity=1). Trigger button + dropdown с двумя scrollable column
// (HH + MM).
//
// Контракт:
//   - value: 'HH:MM' string или null.
//   - onChange: (next: 'HH:MM') => void.
//   - hourMin/hourMax: bounds (inclusive). Default 0–23.
//   - granularity: 1 | 5 | 15 | 30 (default 1).

export type TimePickerProps = {
  value: string | null
  onChange: (next: string) => void
  hourMin?: number
  hourMax?: number
  granularity?: 1 | 5 | 15 | 30
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

function parseHhmm(s: string | null): { h: number; m: number } | null {
  if (!s) return null
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return { h, m: mi }
}

function formatHhmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function TimePicker({
  value,
  onChange,
  hourMin = 0,
  hourMax = 23,
  granularity = 1,
  placeholder = 'Время',
  disabled,
  ariaLabel,
}: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const hourColRef = useRef<HTMLDivElement | null>(null)
  const minuteColRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const parsed = parseHhmm(value)
  const currentH = parsed?.h ?? hourMin
  const currentM = parsed?.m ?? 0

  const hours = useMemo(() => {
    const out: number[] = []
    for (let h = hourMin; h <= hourMax; h++) out.push(h)
    return out
  }, [hourMin, hourMax])

  const minutes = useMemo(() => {
    const out: number[] = []
    for (let m = 0; m < 60; m += granularity) out.push(m)
    return out
  }, [granularity])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

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

  // Scroll selected option into view when opening.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      const hourEl = hourColRef.current?.querySelector<HTMLButtonElement>(
        '[data-selected="true"]',
      )
      const minEl = minuteColRef.current?.querySelector<HTMLButtonElement>(
        '[data-selected="true"]',
      )
      hourEl?.scrollIntoView({ block: 'center', behavior: 'auto' })
      minEl?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [open])

  const handleHourSelect = useCallback(
    (h: number) => {
      onChange(formatHhmm(h, currentM))
    },
    [currentM, onChange],
  )

  const handleMinuteSelect = useCallback(
    (m: number) => {
      onChange(formatHhmm(currentH, m))
    },
    [currentH, onChange],
  )

  const triggerLabel = parsed ? formatHhmm(parsed.h, parsed.m) : placeholder

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
          minHeight: 44,
          minWidth: 92,
          padding: '10px 14px',
          textAlign: 'center',
          background: 'var(--surface-2)',
          color: parsed ? 'var(--text)' : 'var(--text-tertiary, var(--secondary))',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
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
            display: 'flex',
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <Column
            innerRef={hourColRef}
            label="Час"
            items={hours.map((h) => ({
              value: h,
              label: String(h).padStart(2, '0'),
              selected: h === currentH,
            }))}
            onSelect={handleHourSelect}
          />
          <div style={{ width: 1, background: 'var(--border)' }} />
          <Column
            innerRef={minuteColRef}
            label="Мин"
            items={minutes.map((m) => ({
              value: m,
              label: String(m).padStart(2, '0'),
              selected: m === currentM,
            }))}
            onSelect={handleMinuteSelect}
          />
        </div>
      ) : null}
    </div>
  )
}

type ColumnProps = {
  innerRef: React.MutableRefObject<HTMLDivElement | null>
  label: string
  items: Array<{ value: number; label: string; selected: boolean }>
  onSelect: (value: number) => void
}

function Column({ innerRef, label, items, onSelect }: ColumnProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 84,
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          fontSize: 11,
          color: 'var(--text-secondary, var(--secondary))',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {label}
      </div>
      <div
        ref={(el) => {
          innerRef.current = el
        }}
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          padding: 4,
        }}
      >
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            data-selected={it.selected ? 'true' : undefined}
            onClick={() => onSelect(it.value)}
            aria-pressed={it.selected}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              background: it.selected ? 'var(--accent)' : 'transparent',
              color: it.selected
                ? 'var(--text-on-accent, #fff)'
                : 'var(--text)',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: it.selected ? 600 : 500,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              cursor: 'pointer',
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}
