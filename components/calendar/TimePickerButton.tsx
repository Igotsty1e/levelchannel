'use client'

import { useEffect, useRef, useState } from 'react'

import { TimePickerSheet } from './TimePickerSheet'

// Compact chip-style time button. Tapping opens a picker:
//   - on mobile (<600px): bottom-sheet with 30-min step list
//   - on desktop (≥600px): native browser <input type="time" step="1800">
//
// Caller owns the value; this component only fires `onSelect` when
// the user picks a new time. Allowed range is 06:00-22:00 (business
// hours from `lib/calendar/recurrence.ts`).

export type TimePickerButtonProps = {
  label: 'От' | 'До'
  value: string // 'HH:mm', 30-min aligned
  onSelect: (next: string) => void
  disabled?: boolean
  ariaLabel?: string
}

export function TimePickerButton({
  label,
  value,
  onSelect,
  disabled,
  ariaLabel,
}: TimePickerButtonProps) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 600px)')
    const sync = () => setIsDesktop(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])

  function handleClick() {
    if (disabled) return
    if (isDesktop && inputRef.current) {
      // showPicker() opens the native time picker on Chrome/Edge.
      // Safari falls back to focus (which also opens the picker on
      // most macOS versions).
      const el = inputRef.current
      if (typeof el.showPicker === 'function') {
        try {
          el.showPicker()
          return
        } catch {
          // fall through to focus
        }
      }
      el.focus()
      el.click()
      return
    }
    setSheetOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={ariaLabel ?? `${label} — ${value}`}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 6,
          padding: '8px 14px',
          minHeight: 44,
          borderRadius: 999,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: 14,
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 120ms ease, background 120ms ease',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span style={{ color: 'var(--secondary)', fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{value}</span>
      </button>
      {/* Hidden native input — used for desktop showPicker(). */}
      {isDesktop ? (
        <input
          ref={inputRef}
          type="time"
          step={1800}
          value={value}
          min="06:00"
          max="22:00"
          onChange={(e) => {
            const next = e.target.value
            if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(next)) onSelect(next)
          }}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            border: 0,
            margin: 0,
            padding: 0,
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : null}
      {!isDesktop && sheetOpen ? (
        <TimePickerSheet
          title={`${label === 'От' ? 'Начало' : 'Окончание'}`}
          value={value}
          onSelect={(next) => {
            onSelect(next)
            setSheetOpen(false)
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </>
  )
}
