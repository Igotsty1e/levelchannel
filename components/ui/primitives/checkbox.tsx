'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useId } from 'react'

// LevelChannel design-system Checkbox (2026-06-12).
//
// Современный switch-style чекбокс с лейблом справа и опциональной
// подсказкой под лейблом. Работает в:
//   • Form для приглашения ученика — «Активный ученик».
//   • Карточке ученика — тот же.
//   • Multi-select списках тарифов/пакетов внутри инвайта.
//
// Cемантика — стандартный input type=checkbox, поэтому fully accessible:
// клавиатура (Space toggle), screen-reader announce, focus-visible.

type Tone = 'default' | 'accent'

export function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  hint,
  disabled,
  tone = 'accent',
  name,
  id,
}: {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (next: boolean) => void
  /** Видимый лейбл справа от чекбокса. Можно ReactNode для inline-bold. */
  label: ReactNode
  /** Опциональная подсказка-строка под лейблом (~13px, secondary). */
  hint?: ReactNode
  disabled?: boolean
  /** 'accent' — активный заливает accent-цветом; 'default' — нейтрал. */
  tone?: Tone
  name?: string
  id?: string
}) {
  const reactId = useId()
  const inputId = id ?? `lc-cb-${reactId}`
  const fillColor = tone === 'accent' ? 'var(--accent)' : 'var(--text)'
  const borderActive = tone === 'accent' ? 'var(--accent)' : 'var(--text)'

  return (
    <label
      htmlFor={inputId}
      className="lc-checkbox-label"
      style={rootStyle(disabled)}
    >
      <span
        aria-hidden="true"
        className="lc-checkbox-box"
        style={boxStyle(checked ?? defaultChecked ?? false, disabled, fillColor, borderActive)}
      >
        {(checked ?? defaultChecked) ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7l3 3 5-6"
              stroke="var(--text-on-accent, #fff)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <input
        id={inputId}
        name={name}
        type="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        style={visuallyHidden}
      />
      <span style={labelWrapStyle}>
        <span style={labelStyle}>{label}</span>
        {hint ? <span style={hintStyle}>{hint}</span> : null}
      </span>
    </label>
  )
}

function rootStyle(disabled?: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'flex-start',
    gap: 10,
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    opacity: disabled ? 0.55 : 1,
  }
}

function boxStyle(
  checked: boolean,
  disabled: boolean | undefined,
  fill: string,
  border: string,
): CSSProperties {
  return {
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: 6,
    border: '1.5px solid',
    borderColor: checked ? border : 'var(--border)',
    background: checked ? fill : 'var(--surface-2, transparent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 120ms ease-out, border-color 120ms ease-out',
    marginTop: 2,
  }
}

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const labelWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
}

const labelStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text)',
  lineHeight: 1.35,
}

const hintStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  lineHeight: 1.45,
}
