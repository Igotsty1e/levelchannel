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
// minute-start epic Sub-PR A.2 (2026-06-11): minute-precision.
// 2026-06-11 post-review rewrite: scroll-snap "барабан" (iOS-style wheel),
// not a click-list of buttons. Scroll the column — центральная позиция
// = выбор. Tap on a non-center item также её центрирует.
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

const ITEM_HEIGHT = 40 // px — scroll-snap unit
const VISIBLE_ROWS = 5 // odd number so there's a true center row
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS
const CENTER_OFFSET = ((VISIBLE_ROWS - 1) / 2) * ITEM_HEIGHT // padding top/bottom

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
          aria-label={ariaLabel ?? placeholder}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            zIndex: 1200,
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              padding: '0 4px',
            }}
          >
            {/* central highlight band — фиксированная подсветка центра,
                под которой крутятся колёса */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 4,
                right: 4,
                top: CENTER_OFFSET,
                height: ITEM_HEIGHT,
                background: 'var(--accent-bg, rgba(255,255,255,0.06))',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
            <Wheel
              label="Час"
              items={hours}
              value={currentH}
              onChange={handleHourSelect}
            />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <Wheel
              label="Мин"
              items={minutes}
              value={currentM}
              onChange={handleMinuteSelect}
            />
          </div>
          <div
            style={{
              display: 'flex',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                flex: 1,
                padding: '12px 14px',
                background: 'transparent',
                color: 'var(--text)',
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Готово
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type WheelProps = {
  label: string
  items: number[]
  value: number
  onChange: (value: number) => void
}

/**
 * Scroll-snap wheel column — крутится как iOS picker. Каждый item занимает
 * ITEM_HEIGHT, scroll-snap-align: center заставляет браузер сам остановиться
 * на ровной позиции. onScroll throttled через rAF → детектим центр →
 * onChange. Tap на не-центральный item также скроллит его в центр.
 */
function Wheel({ label, items, value, onChange }: WheelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const valueIndex = items.indexOf(value)
  const isProgrammaticScroll = useRef(false)
  const lastEmitted = useRef<number>(value)
  const rafScheduled = useRef(false)

  // Initial scroll to current value (and on external value change).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (valueIndex < 0) return
    const target = valueIndex * ITEM_HEIGHT
    if (Math.abs(el.scrollTop - target) < 1) return
    isProgrammaticScroll.current = true
    el.scrollTop = target
    // give the browser one frame to apply, then re-allow detection
    requestAnimationFrame(() => {
      isProgrammaticScroll.current = false
    })
  }, [valueIndex, items])

  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return
    if (rafScheduled.current) return
    rafScheduled.current = true
    requestAnimationFrame(() => {
      rafScheduled.current = false
      const el = ref.current
      if (!el) return
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT)
      const clamped = Math.max(0, Math.min(items.length - 1, idx))
      const next = items[clamped]
      if (next !== lastEmitted.current) {
        lastEmitted.current = next
        onChange(next)
      }
    })
  }, [items, onChange])

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
          textAlign: 'center',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {label}
      </div>
      <div
        ref={ref}
        onScroll={handleScroll}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        style={{
          height: WHEEL_HEIGHT,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* top spacer so first item can center on the highlight band */}
        <div style={{ height: CENTER_OFFSET, pointerEvents: 'none' }} />
        {items.map((it) => {
          const selected = it === value
          return (
            <button
              key={it}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(it)}
              style={{
                display: 'block',
                width: '100%',
                height: ITEM_HEIGHT,
                lineHeight: `${ITEM_HEIGHT}px`,
                background: 'transparent',
                color: selected
                  ? 'var(--text)'
                  : 'var(--text-secondary, var(--secondary))',
                border: 'none',
                fontSize: selected ? 20 : 16,
                fontWeight: selected ? 700 : 500,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'center',
                cursor: 'pointer',
                padding: 0,
                scrollSnapAlign: 'center',
                scrollSnapStop: 'always',
                opacity: selected ? 1 : 0.55,
                transition: 'opacity 120ms, font-size 120ms, color 120ms',
              }}
            >
              {String(it).padStart(2, '0')}
            </button>
          )
        })}
        {/* bottom spacer so last item can center on the highlight band */}
        <div style={{ height: CENTER_OFFSET, pointerEvents: 'none' }} />
      </div>
    </div>
  )
}
