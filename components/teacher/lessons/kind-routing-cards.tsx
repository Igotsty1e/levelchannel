'use client'

// 3-card routing layout для /teacher/lessons: Уроки / Дела / Оплаты.
// URL — single source of truth: server page ветвится по kind и рендерит
// соответствующий ReactNode, router.replace из этого client island
// меняет URL.
//
// 2026-06-21 — parseKind() и LessonsKind вынесены в lib/teacher/lessons-kind.ts
// потому что Next 16 запрещает импорт client-функций в server component
// (page.tsx). Этот файл теперь чистый client (UI cards + handler).

import { useRouter } from 'next/navigation'

import type { LessonsKind } from '@/lib/teacher/lessons-kind'

export type { LessonsKind } from '@/lib/teacher/lessons-kind'

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
    <div
      role="tablist"
      aria-label="Разделы занятий"
      data-testid="lessons-kind-cards"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 8,
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
    </div>
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
  // 2026-06-22 Epic 2 PR-1b:
  // B-5: <button role="tab" aria-selected> вместо <button> в <nav>.
  //      Согласовано с existing pattern в lessons-tabs-client.tsx. БЕЗ
  //      aria-controls/tabpanel — page server-branches и рендерит ОДИН
  //      panel per URL (2 другие tab указали бы на non-existent ids).
  // H-13: var(--surface) (legacy per design-system §3.1) → var(--surface-1).
  //       Raw rgba fallback на --accent-soft удалён — используем
  //       --accent-bg + --accent-bg-strong tokens напрямую.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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
        background: active ? 'var(--accent-bg-strong)' : 'var(--surface-1)',
        color: 'var(--text)',
        cursor: active ? 'default' : 'pointer',
        transition: 'border-color 120ms ease, background 120ms ease',
        minHeight: 64,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: active ? 600 : 500 }}>{title}</div>
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
