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

import { useTablistKeyboard } from '@/lib/util/use-tablist-keyboard'
import type { LessonsKind } from '@/lib/teacher/lessons-kind'

export type { LessonsKind } from '@/lib/teacher/lessons-kind'

type Props = {
  activeKind: LessonsKind
}

const KINDS: LessonsKind[] = ['lessons', 'deals', 'payments']

export function KindRoutingCards({ activeKind }: Props) {
  const router = useRouter()
  const activeIndex = KINDS.indexOf(activeKind)

  function switchTo(kind: LessonsKind) {
    if (kind === activeKind) return
    const next = new URLSearchParams()
    if (kind !== 'lessons') next.set('kind', kind)
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '/teacher/lessons')
  }

  // Epic 7 (2026-06-24): keyboard nav — стрелки Left/Right/Home/End
  // перемещают фокус и активируют tab (auto-activate WAI-ARIA pattern).
  const { tabProps, onKeyDown } = useTablistKeyboard({
    activeIndex,
    count: KINDS.length,
    onActivate: (i) => switchTo(KINDS[i]),
  })

  return (
    <div
      role="tablist"
      aria-label="Разделы занятий"
      data-testid="lessons-kind-cards"
      onKeyDown={onKeyDown}
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
        onClick={() => switchTo('lessons')}
        a11y={tabProps(0)}
      />
      <Card
        kind="deals"
        title="Дела"
        subtitle="Личные события в календаре"
        onClick={() => switchTo('deals')}
        a11y={tabProps(1)}
      />
      <Card
        kind="payments"
        title="Оплаты"
        subtitle="Заявки, оплаты, возвраты"
        onClick={() => switchTo('payments')}
        a11y={tabProps(2)}
      />
    </div>
  )
}

type CardProps = {
  kind: LessonsKind
  title: string
  subtitle: string
  onClick: () => void
  a11y: ReturnType<ReturnType<typeof useTablistKeyboard>['tabProps']>
}

function Card({ kind, title, subtitle, onClick, a11y }: CardProps) {
  // 2026-06-22 Epic 2 PR-1b + 2026-06-24 Epic 7 a11y:
  // role/aria-selected/tabIndex/ref приходят из useTablistKeyboard через a11y prop.
  // Keyboard navigation (стрелки Left/Right/Home/End) обрабатывается parent
  // tablist через onKeyDown.
  const active = a11y['aria-selected']
  return (
    <button
      type="button"
      {...a11y}
      ref={a11y.ref as React.Ref<HTMLButtonElement>}
      onClick={onClick}
      data-kind={kind}
      data-active={active ? 'true' : 'false'}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'var(--accent-bg-strong)' : 'var(--surface-1)',
        color: 'var(--text)',
        cursor: active ? 'default' : 'pointer',
        transition: 'border-color 120ms ease, background 120ms ease',
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
