import type { CSSProperties } from 'react'
import Link from 'next/link'

import type { TeacherFinanceSnapshot } from '@/lib/billing/teacher-finance'

// Hero-вариант (2026-06-12, owner-выбор).
//
// Одна крупная цифра «Заработано в этом месяце» сверху + 3 побочных
// строки под ней. Без delta-percent, без warning-badges, без coach-
// hint и skeleton-плитки. Если у учителя ещё нет ни одного слота —
// секция скрывается полностью (главная остаётся без шума).

const RUB_FORMAT = new Intl.NumberFormat('ru-RU')

function fmtRub(kopecks: number): string {
  if (!Number.isFinite(kopecks)) return '0 ₽'
  return `${RUB_FORMAT.format(Math.round(kopecks / 100))} ₽`
}

const MONTH_PREPOSITIONAL: Record<number, string> = {
  0: 'ЯНВАРЕ',
  1: 'ФЕВРАЛЕ',
  2: 'МАРТЕ',
  3: 'АПРЕЛЕ',
  4: 'МАЕ',
  5: 'ИЮНЕ',
  6: 'ИЮЛЕ',
  7: 'АВГУСТЕ',
  8: 'СЕНТЯБРЕ',
  9: 'ОКТЯБРЕ',
  10: 'НОЯБРЕ',
  11: 'ДЕКАБРЕ',
}

function currentMonthUpper(): string {
  return MONTH_PREPOSITIONAL[new Date().getMonth()] ?? ''
}

export function TeacherFinanceSummary({
  snapshot,
}: {
  snapshot: TeacherFinanceSnapshot
}) {
  // Hero-вариант скрывает секцию для учителей без слотов: skeleton +
  // coach-hint выпиливаются вместе со старым UI. Onboarding-checklist
  // и greeting-CTA уже ведут учителя к первому слоту — финансовая
  // карточка появляется автоматически, когда деньги/долги уже есть.
  if (!snapshot.emptyState.hasAnySlot) {
    return null
  }

  const earned = fmtRub(snapshot.thisMonth.confirmedKopecks)
  const monthLabel = currentMonthUpper()

  return (
    <section aria-labelledby="finance-summary-title" style={sectionStyle}>
      <div style={heroStyle}>
        <span id="finance-summary-title" style={heroLabelStyle}>
          ЗАРАБОТАНО В {monthLabel}
        </span>
        <strong style={heroNumberStyle}>{earned}</strong>
      </div>
      <hr style={dividerStyle} aria-hidden="true" />
      <ul style={listStyle}>
        <SecondaryRow
          href="/teacher/payments"
          label="Должны прямо сейчас"
          value={fmtRub(snapshot.unpaid.totalKopecks)}
        />
        <SecondaryRow
          href="/teacher/packages"
          label="Предоплата у учеников"
          value={fmtRub(snapshot.activePackages.sumOfRemainingKopecks)}
        />
        <SecondaryRow
          href="/teacher/calendar"
          label="Ожидается на этой неделе"
          value={fmtRub(snapshot.expectedThisWeek.kopecks)}
        />
      </ul>
    </section>
  )
}

function SecondaryRow({
  href,
  label,
  value,
}: {
  href: string
  label: string
  value: string
}) {
  return (
    <li style={listItemStyle}>
      <Link href={href} style={rowLinkStyle} aria-label={`${label}: ${value}`}>
        <span style={rowLabelStyle}>{label}</span>
        <span style={rowValueStyle}>{value}</span>
      </Link>
    </li>
  )
}

const sectionStyle: CSSProperties = {
  marginTop: 16,
  marginBottom: 24,
  padding: '24px 24px 20px',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
}

const heroStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 20,
}

const heroLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  lineHeight: 1.2,
}

const heroNumberStyle: CSSProperties = {
  fontSize: 'clamp(36px, 5vw, 44px)',
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1.05,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.01em',
}

const dividerStyle: CSSProperties = {
  border: 0,
  borderTop: '1px solid var(--border)',
  margin: '0 0 12px',
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const listItemStyle: CSSProperties = {
  display: 'block',
}

const rowLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 44,
  padding: '12px 0',
  textDecoration: 'none',
  color: 'inherit',
  borderBottom: '0',
}

const rowLabelStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--secondary)',
  lineHeight: 1.3,
}

const rowValueStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text)',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.01em',
  whiteSpace: 'nowrap',
}
