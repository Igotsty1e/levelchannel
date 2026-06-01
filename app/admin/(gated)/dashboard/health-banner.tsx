import type { HealthBanner } from '@/lib/admin/dashboard-types'

const STATE_STYLES = {
  ok: {
    bg: 'rgba(92, 138, 106, 0.16)',
    border: '#5c8a6a',
    color: '#9ed6a6',
    icon: '✅',
  },
  warn: {
    bg: 'rgba(182, 114, 32, 0.16)',
    border: '#b67220',
    color: '#f0c089',
    icon: '⚠️',
  },
  alert: {
    bg: 'rgba(208, 74, 46, 0.18)',
    border: '#d04a2e',
    color: '#ff8a8a',
    icon: '🚨',
  },
} as const

export function HealthBannerView({ banner }: { banner: HealthBanner }) {
  const s = STATE_STYLES[banner.state]
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'baseline',
        padding: '14px 16px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 10,
        marginBottom: 24,
        color: s.color,
      }}
    >
      <span style={{ fontSize: 22 }} aria-hidden="true">
        {s.icon}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <strong style={{ fontSize: 15 }}>{banner.reason}</strong>
        {banner.belowThreshold.length > 0 ? (
          <span style={{ fontSize: 12, color: s.color, opacity: 0.8, marginTop: 2 }}>
            {banner.belowThreshold.join(' · ')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
