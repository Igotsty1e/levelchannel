'use client'

import { useEffect, useMemo, useRef } from 'react'

// Mobile bottom-sheet time picker — used by TimePickerButton on
// viewports < 600px (desktop uses the native browser picker).
//
// Renders a scrollable 30-min grid between 06:00 and 22:00 (business
// hours from `lib/calendar/recurrence.ts`). Tapping a row selects +
// closes. Auto-scrolls to current value on mount. ESC closes.

const BUSINESS_START_MIN = 6 * 60
const BUSINESS_END_MIN = 22 * 60
const STEP_MIN = 30

function buildOptions(): string[] {
  const opts: string[] = []
  for (let m = BUSINESS_START_MIN; m <= BUSINESS_END_MIN; m += STEP_MIN) {
    const hh = Math.floor(m / 60)
    const mm = m % 60
    opts.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
  }
  return opts
}

export function TimePickerSheet({
  title,
  value,
  onSelect,
  onClose,
}: {
  title: string
  value: string
  onSelect: (next: string) => void
  onClose: () => void
}) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null)
  const options = useMemo(() => buildOptions(), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const id = window.setTimeout(() => {
      activeRowRef.current?.scrollIntoView({ block: 'center' })
    }, 30)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '70vh',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: '14px 12px calc(14px + env(safe-area-inset-bottom))',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: 'var(--border)',
            margin: '0 auto 4px',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '0 8px',
            marginBottom: 4,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
            06:00 — 22:00 · шаг 30 мин
          </span>
        </div>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 6,
          }}
        >
          {options.map((opt) => {
            const isActive = opt === value
            return (
              <li key={opt}>
                <button
                  ref={isActive ? activeRowRef : undefined}
                  type="button"
                  onClick={() => onSelect(opt)}
                  aria-pressed={isActive}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    borderRadius: 8,
                    border: `1px solid ${
                      isActive ? 'var(--accent, #D88A82)' : 'var(--border)'
                    }`,
                    background: isActive
                      ? 'var(--accent-bg, rgba(216,138,130,0.10))'
                      : 'transparent',
                    color: 'var(--text)',
                    fontSize: 15,
                    fontWeight: isActive ? 600 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    cursor: 'pointer',
                  }}
                >
                  {opt}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
