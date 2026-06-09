import type { CSSProperties } from 'react'
import Link from 'next/link'

import type { TeacherFinanceSnapshot } from '@/lib/billing/teacher-finance'

const RUB_FORMAT = new Intl.NumberFormat('ru-RU')

function fmtRub(kopecks: number): string {
  if (!Number.isFinite(kopecks)) return '0 ₽'
  return `${RUB_FORMAT.format(Math.round(kopecks / 100))} ₽`
}

const OVERDUE_ALERT_DAYS = 7

export function TeacherFinanceSummary({
  snapshot,
}: {
  snapshot: TeacherFinanceSnapshot
}) {
  const allZero =
    snapshot.thisMonth.confirmedKopecks === 0 &&
    snapshot.unpaid.totalKopecks === 0 &&
    snapshot.activePackages.sumOfRemainingKopecks === 0 &&
    snapshot.expectedThisWeek.kopecks === 0
  if (allZero) return null

  const overdueAlert = snapshot.unpaid.oldestDaysOverdue >= OVERDUE_ALERT_DAYS
  const packagesAlert = snapshot.activePackages.expiringSoonCount > 0

  return (
    <section aria-labelledby="finance-summary-title" style={sectionStyle}>
      <h2 id="finance-summary-title" style={titleStyle}>
        Финансы
      </h2>
      <div style={gridStyle}>
        <FinanceCard
          href="/teacher/payments"
          title="Заработано в этом месяце"
          number={fmtRub(snapshot.thisMonth.confirmedKopecks)}
          sub={
            snapshot.thisMonth.deltaPercent !== null
              ? `${snapshot.thisMonth.deltaPercent > 0 ? '+' : ''}${snapshot.thisMonth.deltaPercent}% к прошлому месяцу`
              : `с 1 ${snapshot.thisMonth.monthLabel.split(' ')[0]}`
          }
        />
        <FinanceCard
          href="/teacher/payments"
          title="Должны прямо сейчас"
          number={fmtRub(snapshot.unpaid.totalKopecks)}
          sub={
            snapshot.unpaid.learnerCount > 0
              ? `${snapshot.unpaid.learnerCount} ${plural(snapshot.unpaid.learnerCount, 'ученик', 'ученика', 'учеников')}`
              : 'нет долгов'
          }
          tone={overdueAlert ? 'warn' : 'default'}
          alertText={
            overdueAlert
              ? `${snapshot.unpaid.oldestDaysOverdue} дн. просрочки`
              : undefined
          }
        />
        <FinanceCard
          href="/teacher/packages"
          title="Предоплата у учеников"
          number={fmtRub(snapshot.activePackages.sumOfRemainingKopecks)}
          sub={
            snapshot.activePackages.learnersWithPackages > 0
              ? `${snapshot.activePackages.learnersWithPackages} ${plural(snapshot.activePackages.learnersWithPackages, 'ученик', 'ученика', 'учеников')}`
              : 'нет активных пакетов'
          }
          tone={packagesAlert ? 'warn' : 'default'}
          alertText={
            packagesAlert
              ? `${snapshot.activePackages.expiringSoonCount} заканчиваются`
              : undefined
          }
        />
        <FinanceCard
          href="/teacher/calendar"
          title="Ожидается на этой неделе"
          number={fmtRub(snapshot.expectedThisWeek.kopecks)}
          sub={
            snapshot.expectedThisWeek.bookedSlotsCount > 0
              ? `${snapshot.expectedThisWeek.bookedSlotsCount} ${plural(snapshot.expectedThisWeek.bookedSlotsCount, 'занятие', 'занятия', 'занятий')} до воскресенья`
              : 'нет booked-слотов'
          }
        />
      </div>
    </section>
  )
}

function FinanceCard({
  href,
  title,
  number,
  sub,
  tone = 'default',
  alertText,
}: {
  href: string
  title: string
  number: string
  sub: string
  tone?: 'default' | 'warn'
  alertText?: string
}) {
  return (
    <Link href={href} aria-label={`${title}: ${number}. ${sub}`} style={cardStyle}>
      <div style={cardTitleStyle}>{title}</div>
      <div style={cardNumberStyle}>{number}</div>
      <div style={cardSubStyle}>{sub}</div>
      {alertText ? (
        <div style={tone === 'warn' ? warnBadgeStyle : defaultBadgeStyle}>
          {alertText}
        </div>
      ) : null}
    </Link>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

const sectionStyle: CSSProperties = {
  marginTop: 16,
  marginBottom: 24,
}

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  margin: '0 0 10px',
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 10,
}

const cardStyle: CSSProperties = {
  display: 'block',
  padding: 16,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  textDecoration: 'none',
  color: 'inherit',
}

const cardTitleStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
  marginBottom: 6,
  lineHeight: 1.3,
}

const cardNumberStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1.1,
}

const cardSubStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
  marginTop: 6,
}

const warnBadgeStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: 8,
  padding: '2px 8px',
  borderRadius: 99,
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(245, 194, 107, 0.18)',
  border: '1px solid rgba(245, 194, 107, 0.4)',
  color: 'var(--text)',
}

const defaultBadgeStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: 8,
  padding: '2px 8px',
  borderRadius: 99,
  fontSize: 11,
  fontWeight: 600,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--secondary)',
}
