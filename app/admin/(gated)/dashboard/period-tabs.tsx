import Link from 'next/link'

import type { PeriodKey } from '@/lib/admin/dashboard-period'

const TABS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: '1d', label: 'Сутки' },
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
  { key: 'all', label: 'Всё время' },
]

export function PeriodTabs({ active }: { active: PeriodKey }) {
  return (
    <div
      role="tablist"
      aria-label="Период"
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 16,
        alignItems: 'center',
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={`/admin/dashboard?period=${t.key}`}
            role="tab"
            aria-selected={isActive}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: isActive ? 'var(--border)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--secondary)',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              textDecoration: 'none',
              minHeight: 34,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {t.label}
          </Link>
        )
      })}
      <span
        style={{ color: 'var(--secondary)', fontSize: 11, marginLeft: 8 }}
        title="Окно скользящее от текущего момента"
      >
        ⓘ скользящее окно
      </span>
    </div>
  )
}
