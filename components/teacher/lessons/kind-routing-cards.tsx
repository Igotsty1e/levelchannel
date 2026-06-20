'use client'

// 3-card routing layout для /teacher/lessons: Уроки / Дела / Оплаты.
// URL — single source of truth: useSearchParams читает kind, router.replace пишет.
// Server page.tsx ветвится по kind и рендерит соответствующий ReactNode.

import { useRouter } from 'next/navigation'

export type LessonsKind = 'lessons' | 'deals' | 'payments'

export function parseKind(raw: string | null | undefined): LessonsKind {
  if (raw === 'deals' || raw === 'payments') return raw
  return 'lessons'
}

type Props = {
  activeKind: LessonsKind
}

export function KindRoutingCards({ activeKind }: Props) {
  const router = useRouter()

  function switchTo(kind: LessonsKind) {
    if (kind === activeKind) return
    const next = new URLSearchParams()
    if (kind !== 'lessons') next.set('kind', kind)
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '/teacher/lessons')
  }

  return (
    <nav
      aria-label="Разделы занятий"
      data-testid="lessons-kind-cards"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 8,
        marginBottom: 16,
      }}
    >
      <Card
        kind="lessons"
        title="Уроки"
        subtitle="История и фильтры"
        active={activeKind === 'lessons'}
        onClick={() => switchTo('lessons')}
      />
      <Card
        kind="deals"
        title="Дела"
        subtitle="Личные события в календаре"
        active={activeKind === 'deals'}
        onClick={() => switchTo('deals')}
      />
      <Card
        kind="payments"
        title="Оплаты"
        subtitle="Заявки, оплаты, возвраты"
        active={activeKind === 'payments'}
        onClick={() => switchTo('payments')}
      />
    </nav>
  )
}

type CardProps = {
  kind: LessonsKind
  title: string
  subtitle: string
  active: boolean
  onClick: () => void
}

function Card({ kind, title, subtitle, active, onClick }: CardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-kind={kind}
      data-active={active ? 'true' : 'false'}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: active
          ? '1px solid var(--accent)'
          : '1px solid var(--border)',
        background: active
          ? 'var(--accent-soft, rgba(80, 130, 255, 0.06))'
          : 'var(--surface)',
        color: 'var(--text)',
        cursor: active ? 'default' : 'pointer',
        transition: 'border-color 120ms ease, background 120ms ease',
        minHeight: 64,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--secondary)',
          marginTop: 4,
          lineHeight: 1.4,
        }}
      >
        {subtitle}
      </div>
    </button>
  )
}
