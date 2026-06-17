'use client'

// 2026-06-17 — segmented control для /cabinet/lessons (История / Оплаты).
// Owner-feedback: «И внутри него еще таб с оплатами — чтобы все тоже
// было в одном едином месте».

import { useRouter, useSearchParams } from 'next/navigation'

type Props = {
  active: 'history' | 'payments'
  historyCount: number
  paymentsCount: number
  pendingCount: number
}

export function LessonsTabsClient({
  active,
  historyCount,
  paymentsCount,
  pendingCount,
}: Props) {
  const router = useRouter()
  const sp = useSearchParams()

  function setTab(next: 'history' | 'payments') {
    const params = new URLSearchParams(sp?.toString() ?? '')
    if (next === 'history') params.delete('tab')
    else params.set('tab', 'payments')
    const qs = params.toString()
    router.push(qs ? `/cabinet/lessons?${qs}` : '/cabinet/lessons')
  }

  return (
    <div
      role="tablist"
      aria-label="Содержимое страницы занятий"
      style={{
        display: 'inline-flex',
        gap: 4,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 4,
        marginBottom: 20,
      }}
    >
      <TabBtn
        active={active === 'history'}
        onClick={() => setTab('history')}
        label="История"
        count={historyCount}
      />
      <TabBtn
        active={active === 'payments'}
        onClick={() => setTab('payments')}
        label="Оплаты"
        count={paymentsCount}
        badge={pendingCount > 0 ? pendingCount : null}
      />
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  label,
  count,
  badge,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  badge?: number | null
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--secondary)',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 400,
          color: active ? 'var(--accent)' : 'var(--secondary)',
        }}
      >
        · {count}
      </span>
      {badge !== null && badge !== undefined ? (
        <span
          aria-label={`${badge} требуют внимания`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'rgba(255, 200, 130, 0.15)',
            color: '#ffc882',
            marginLeft: 2,
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
