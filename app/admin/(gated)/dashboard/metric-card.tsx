import { formatDelta } from '@/lib/admin/dashboard-period'
import type { BucketPoint, MetricValue } from '@/lib/admin/dashboard-types'

import { Sparkline } from './client'

export function MetricCard({
  label,
  value,
  sparkline,
  rateDenominator,
  showDelta,
  drillHref,
}: {
  label: string
  value: MetricValue
  sparkline?: BucketPoint[]
  /** When set, shows "(% of denominator)" subline (no-show as rate). */
  rateDenominator?: number
  /** Whether to show vs-prev delta line. Hidden for `'all'` period. */
  showDelta: boolean
  drillHref?: string
}) {
  const delta = showDelta ? formatDelta(value.current, value.previous) : null
  const rate =
    rateDenominator !== undefined && rateDenominator > 0
      ? Math.round((value.current / rateDenominator) * 100)
      : null

  const inner = (
    <>
      <div style={{ fontSize: 12, color: 'var(--secondary)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
        {value.current}
        {rate !== null ? (
          <span
            style={{
              fontSize: 13,
              color: 'var(--secondary)',
              fontWeight: 400,
              marginLeft: 6,
            }}
          >
            {rate}%
          </span>
        ) : null}
      </div>
      {delta ? (
        <div
          style={{
            fontSize: 12,
            marginTop: 4,
            color: delta.startsWith('-')
              ? '#ff8a8a'
              : delta === '+0%' || delta === '—'
                ? 'var(--secondary)'
                : '#9ed6a6',
          }}
        >
          {delta === '—' ? '—' : `${delta} vs предыдущий`}
        </div>
      ) : null}
      {sparkline ? (
        <div style={{ marginTop: 8 }}>
          <Sparkline data={sparkline} />
        </div>
      ) : null}
    </>
  )

  const cardStyle = {
    padding: 16,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    minHeight: 110,
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
  } as const

  if (drillHref) {
    return (
      <a href={drillHref} style={cardStyle} aria-label={`${label}: подробнее`}>
        {inner}
      </a>
    )
  }
  return <div style={cardStyle}>{inner}</div>
}
