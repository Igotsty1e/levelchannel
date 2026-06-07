import type { ReactNode } from 'react'

// Read-only badge/counter. Use for «5/5 учеников», «оплачено», «истекло»,
// statuses on cards/rows. NOT for clickable affordances — that's <Button>.

export type PillTone = 'default' | 'accent' | 'warning' | 'danger' | 'success'

export type PillProps = {
  tone?: PillTone
  size?: 'sm' | 'md'
  children: ReactNode
  title?: string
}

const TONE_BG: Record<PillTone, string> = {
  default: 'rgba(255,255,255,0.05)',
  accent: 'var(--accent-bg, rgba(216,138,130,0.10))',
  warning: 'var(--warning-bg, rgba(245,194,107,0.10))',
  danger: 'var(--danger-bg, rgba(255,110,110,0.12))',
  success: 'rgba(155, 223, 155, 0.10)',
}

const TONE_COLOR: Record<PillTone, string> = {
  default: 'var(--secondary)',
  accent: 'var(--accent, #D88A82)',
  warning: 'var(--warning, #F5C26B)',
  danger: 'var(--danger, #FF6E6E)',
  success: '#9BDF9B',
}

export function Pill({ tone = 'default', size = 'md', children, title }: PillProps) {
  const pad = size === 'sm' ? '2px 8px' : '4px 10px'
  const fontSize = size === 'sm' ? 11 : 13
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: pad,
        borderRadius: 999,
        fontSize,
        fontWeight: 600,
        lineHeight: 1.2,
        background: TONE_BG[tone],
        color: TONE_COLOR[tone],
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
