'use client'

import type { ReactNode } from 'react'

// CollapsibleCard — раскрывающийся блок-карточка на нативном
// <details>/<summary>. Семантика и a11y бесплатно (Enter/Space,
// screen reader announce, focus visible).
//
// Использование: оборачивает секции, которые занимают много места
// и не нужны в большинстве сессий (приглашение нового ученика,
// расширенные настройки). При закрытом состоянии видны только
// заголовок и опциональный `meta` справа.
//
// Стили — design tokens `.saas-chrome`. Hover на summary — едва
// заметный сдвиг фона; раскрытое состояние — chevron поворачивается.

export function CollapsibleCard({
  title,
  defaultOpen = false,
  meta,
  description,
  children,
}: {
  title: string
  defaultOpen?: boolean
  meta?: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <details
      className="card lc-collapsible-card"
      open={defaultOpen}
      style={{
        background: 'var(--card, var(--surface-2))',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 0,
        marginBottom: 24,
      }}
    >
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          cursor: 'pointer',
          listStyle: 'none',
          userSelect: 'none',
          borderRadius: 16,
        }}
      >
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text)',
              lineHeight: 1.3,
            }}
          >
            {title}
          </span>
          {description ? (
            <span
              style={{
                fontSize: 13,
                color: 'var(--secondary, var(--text-secondary))',
                lineHeight: 1.4,
              }}
            >
              {description}
            </span>
          ) : null}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            flex: '0 0 auto',
          }}
        >
          {meta}
          <span
            aria-hidden="true"
            className="lc-collapsible-chevron"
            style={{
              display: 'inline-flex',
              width: 20,
              height: 20,
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--secondary, var(--text-secondary))',
              transition: 'transform 0.18s ease',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 5l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
      </summary>
      <div style={{ padding: '4px 20px 20px' }}>{children}</div>
    </details>
  )
}
