import type { ReactNode } from 'react'

// Zero-state block. Pair every empty list with one of these instead of
// a bare «нет данных» paragraph.

export type EmptyStateProps = {
  icon?: ReactNode
  title: string
  body?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '32px 24px',
        textAlign: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 12,
        color: 'var(--secondary)',
      }}
    >
      {icon ? (
        <div aria-hidden="true" style={{ fontSize: 28, opacity: 0.8 }}>
          {icon}
        </div>
      ) : null}
      <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 600 }}>
        {title}
      </div>
      {body ? (
        <div style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 420 }}>{body}</div>
      ) : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  )
}
