import type { ReactNode } from 'react'

// Page-level status / alert block. Three tones; optional icon + action.

export type BannerTone = 'info' | 'warning' | 'danger' | 'success'

export type BannerProps = {
  tone?: BannerTone
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}

const TONE_STYLE: Record<BannerTone, { bg: string; border: string }> = {
  info: {
    bg: 'rgba(110,168,254,0.10)',
    border: 'rgba(110,168,254,0.45)',
  },
  warning: {
    bg: 'var(--warning-bg, rgba(245,194,107,0.10))',
    border: 'var(--warning, #F5C26B)',
  },
  danger: {
    bg: 'var(--danger-bg, rgba(255,110,110,0.12))',
    border: 'var(--danger, #FF6E6E)',
  },
  success: {
    bg: 'rgba(155,223,155,0.10)',
    border: '#9BDF9B',
  },
}

export function Banner({ tone = 'info', icon, action, children }: BannerProps) {
  const s = TONE_STYLE[tone]
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      {icon ? (
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 18 }}>
          {icon}
        </span>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  )
}
