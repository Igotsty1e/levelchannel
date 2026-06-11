'use client'

import {
  KeyboardEvent as RKbdEvent,
  WheelEvent as RWheelEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

// LevelChannel time picker — design-system primitive.
//
// minute-start epic Sub-PR A.2 (2026-06-11): minute-precision.
// 2026-06-11 web-redesign: scroll-snap wheel barrel was confusing on
// desktop (no obvious affordance to scroll, looked like a click-list).
// Replaced with inline dual-stepper — two number cells (часы и минуты)
// side-by-side, type-or-arrow editing, no popover.
//
// References shaping the design:
//   - Stripe Dashboard datetime — inline 2-cell stepper
//   - Linear due-date picker — text input + smart parse
//   - Google Calendar — text + dropdown, but typing is the fast path
//   - macOS time field — two stepper cells (closest to what we built)
//
// Контракт API не изменился — `value: 'HH:MM' | null`, `onChange`,
// `hourMin`/`hourMax`/`granularity`. Любой existing call-site работает.
//
// Behaviour matrix (на КАЖДОЙ из двух ячеек):
//   Click            → выделить весь текст, готов к набору
//   Type digit(s)    → буферизуется, padStart до 2, clamp в [min..max]
//   Enter / Tab      → commit, перейти к следующей ячейке
//   Blur             → commit (padded и clamped)
//   ↑ / ↓            → ±step (с wrap)
//   ⇧ + ↑ / ↓        → ±step×5
//   Mouse wheel      → ±step (preventDefault)
//   ▲ / ▼ кнопки     → ±step (для touch и мыши без колеса)

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

function clampWrap(v: number, min: number, max: number): number {
  const span = max - min + 1
  let next = v
  while (next > max) next -= span
  while (next < min) next += span
  return next
}

function snapToStep(v: number, step: number, min: number, max: number): number {
  if (step <= 1) return clampWrap(v, min, max)
  // snap to nearest step boundary within [min..max]
  const offset = min % step
  const snapped = Math.round((v - offset) / step) * step + offset
  return clampWrap(snapped, min, max)
}

export function TimePicker({
  value,
  onChange,
  hourMin = 0,
  hourMax = 23,
  granularity = 1,
  placeholder = '',
  disabled,
  ariaLabel,
}: TimePickerProps) {
  const id = useId()
  const minuteRef = useRef<HTMLInputElement | null>(null)

  const parsed = parseHhmm(value)
  const h = parsed?.h ?? hourMin
  const m = parsed?.m ?? 0

  const emit = useCallback(
    (nextH: number, nextM: number) => {
      onChange(formatHhmm(nextH, nextM))
    },
    [onChange],
  )

  const onHour = useCallback(
    (next: number) => {
      emit(clampWrap(next, hourMin, hourMax), m)
    },
    [emit, hourMin, hourMax, m],
  )

  const onMinute = useCallback(
    (next: number) => {
      emit(h, snapToStep(next, granularity, 0, 59))
    },
    [emit, h, granularity],
  )

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? placeholder}
      aria-disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <NumberCell
        id={`${id}-h`}
        value={h}
        min={hourMin}
        max={hourMax}
        step={1}
        ariaLabel="Час"
        disabled={disabled}
        onChange={onHour}
        onCommitNext={() => minuteRef.current?.focus()}
      />
      <span
        aria-hidden="true"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--secondary)',
          fontVariantNumeric: 'tabular-nums',
          padding: '0 2px',
          userSelect: 'none',
        }}
      >
        :
      </span>
      <NumberCell
        id={`${id}-m`}
        inputRef={minuteRef}
        value={m}
        min={0}
        max={59}
        step={granularity}
        ariaLabel="Минута"
        disabled={disabled}
        onChange={onMinute}
      />
    </div>
  )
}

type NumberCellProps = {
  id: string
  inputRef?: React.MutableRefObject<HTMLInputElement | null>
  value: number
  min: number
  max: number
  step: number
  ariaLabel: string
  disabled?: boolean
  onChange: (next: number) => void
  onCommitNext?: () => void
}

function NumberCell({
  id,
  inputRef,
  value,
  min,
  max,
  step,
  ariaLabel,
  disabled,
  onChange,
  onCommitNext,
}: NumberCellProps) {
  const [focused, setFocused] = useState(false)
  const [buffer, setBuffer] = useState<string | null>(null)
  const localRef = useRef<HTMLInputElement | null>(null)
  const ref = inputRef ?? localRef

  // When the external value changes (parent state update), clear the
  // local buffer so the input reflects the canonical 2-digit value.
  useEffect(() => {
    if (!focused) setBuffer(null)
  }, [value, focused])

  const display = buffer ?? String(value).padStart(2, '0')

  const commit = useCallback(
    (raw: string) => {
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        setBuffer(null)
        return
      }
      const clamped = Math.max(min, Math.min(max, Math.round(n)))
      // snap to step if step > 1 (e.g. minute granularity)
      const stepped = step > 1
        ? Math.round((clamped - (min % step)) / step) * step + (min % step)
        : clamped
      const finalV = Math.max(min, Math.min(max, stepped))
      setBuffer(null)
      onChange(finalV)
    },
    [min, max, step, onChange],
  )

  const bump = useCallback(
    (delta: number) => {
      const span = max - min + 1
      let next = value + delta
      while (next > max) next -= span
      while (next < min) next += span
      onChange(next)
    },
    [value, min, max, onChange],
  )

  const onKey = useCallback(
    (e: RKbdEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        bump(e.shiftKey ? step * 5 : step)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        bump(e.shiftKey ? -step * 5 : -step)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer != null) commit(buffer)
        if (e.key === 'Enter' && onCommitNext) {
          e.preventDefault()
          onCommitNext()
        }
      } else if (e.key === 'Escape') {
        setBuffer(null)
        ref.current?.blur()
      }
    },
    [bump, buffer, commit, onCommitNext, ref, step],
  )

  const onWheel = useCallback(
    (e: RWheelEvent<HTMLInputElement>) => {
      if (!focused) return
      e.preventDefault()
      bump(e.deltaY > 0 ? -step : step)
    },
    [focused, bump, step],
  )

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${ariaLabel} +${step}`}
        onClick={() => bump(step)}
        disabled={disabled}
        style={chevronStyle(focused)}
      >
        <span aria-hidden="true">▲</span>
      </button>
      <input
        ref={(el) => {
          ref.current = el
        }}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        value={display}
        disabled={disabled}
        onFocus={(e) => {
          setFocused(true)
          // select all so user can immediately retype
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          if (buffer != null) commit(buffer)
        }}
        onChange={(e) => {
          const raw = e.currentTarget.value.replace(/\D/g, '').slice(0, 2)
          setBuffer(raw)
          // auto-advance when 2 digits typed at the top of the range
          if (raw.length === 2 && onCommitNext) {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= min && n <= max) {
              commit(raw)
              // micro-defer to let onChange propagate first
              setTimeout(() => onCommitNext(), 0)
            }
          }
        }}
        onKeyDown={onKey}
        onWheel={onWheel}
        style={{
          width: 60,
          padding: '10px 8px',
          textAlign: 'center',
          fontSize: 20,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.5,
          background: 'var(--surface-2)',
          color: 'var(--text)',
          border: focused
            ? '1px solid var(--accent)'
            : '1px solid var(--border)',
          borderRadius: 8,
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'text',
          // dark-mode caret
          caretColor: 'var(--accent)',
          // hide native spinner if any user-agent shows one
          MozAppearance: 'textfield',
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${ariaLabel} -${step}`}
        onClick={() => bump(-step)}
        disabled={disabled}
        style={chevronStyle(focused)}
      >
        <span aria-hidden="true">▼</span>
      </button>
    </div>
  )
}

function chevronStyle(focused: boolean): React.CSSProperties {
  // In-flow flex child — no absolute positioning, so the chevrons
  // занимают свою высоту и не залазят на соседние labels.
  return {
    width: '100%',
    height: 20,
    border: 'none',
    background: 'transparent',
    color: focused ? 'var(--accent)' : 'var(--secondary)',
    fontSize: 10,
    lineHeight: '20px',
    cursor: 'pointer',
    opacity: focused ? 1 : 0.5,
    transition: 'opacity 120ms, color 120ms',
    padding: 0,
  }
}
