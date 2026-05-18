'use client'

// Wave A — week navigation + lastUpdatedAt + refresh button.
// Codex round 1 #21 + round 4: `lastUpdatedAt` shown prominently,
// refresh forces a refetch, mutation paths trigger forced refetch
// (wired in PR3).

export type ToolbarProps = {
  fromYmd: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onRefresh: () => void
  lastUpdatedAt: Date | null
  loading: boolean
}

export function Toolbar({
  fromYmd,
  onPrev,
  onNext,
  onToday,
  onRefresh,
  lastUpdatedAt,
  loading,
}: ToolbarProps) {
  const lastLabel = lastUpdatedAt
    ? `Обновлено ${formatRelative(lastUpdatedAt)}`
    : '—'

  return (
    <div
      role="toolbar"
      aria-label="Управление календарём"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 0',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={loading}
        style={btnStyle()}
        aria-label="Предыдущая неделя"
      >
        ← Предыдущая
      </button>
      <button type="button" onClick={onToday} disabled={loading} style={btnStyle()}>
        На этой неделе
      </button>
      <button type="button" onClick={onNext} disabled={loading} style={btnStyle()} aria-label="Следующая неделя">
        Следующая →
      </button>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        Неделя от <strong style={{ color: '#e4e4e7' }}>{fromYmd}</strong>
      </div>
      <div style={{ fontSize: 11, color: '#71717a' }}>{lastLabel}</div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        style={btnStyle()}
        aria-label="Обновить календарь"
      >
        {loading ? 'Загружаем…' : '↻ Обновить'}
      </button>
    </div>
  )
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 13,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#e4e4e7',
    cursor: 'pointer',
  }
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime()
  const sec = Math.round(ms / 1000)
  if (sec < 5) return 'только что'
  if (sec < 60) return `${sec} сек назад`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.round(min / 60)
  return `${hr} ч назад`
}
