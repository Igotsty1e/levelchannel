'use client'

import type { ReactNode } from 'react'

// Radio-group of pill buttons. Use for 2-5 mutually-exclusive options
// (duration, tariff when ≤3, simple filters). Beyond 5 reach for <select>.

export type ChipOption<T extends string> = {
  value: T
  label: ReactNode
}

export type ChipGroupProps<T extends string> = {
  name: string
  value: T
  options: ReadonlyArray<ChipOption<T>>
  onChange: (next: T) => void
  size?: 'sm' | 'md'
}

export function ChipGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  size = 'md',
}: ChipGroupProps<T>) {
  const pad = size === 'sm' ? '4px 10px' : '6px 12px'
  const fontSize = size === 'sm' ? 12 : 13
  return (
    <div
      role="radiogroup"
      aria-label={name}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            style={{
              padding: pad,
              borderRadius: 999,
              fontSize,
              fontWeight: isActive ? 600 : 500,
              border: `1px solid ${isActive ? 'var(--accent, #D88A82)' : 'var(--border)'}`,
              background: isActive
                ? 'var(--accent-bg, rgba(216,138,130,0.10))'
                : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              transition: 'background 120ms ease, border-color 120ms ease',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
