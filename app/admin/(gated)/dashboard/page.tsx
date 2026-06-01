import type { DashboardData } from '@/lib/admin/dashboard-types'
import { parsePeriodOrDefault } from '@/lib/admin/dashboard-period'
import { loadDashboardData } from '@/lib/admin/dashboard'

import { FunnelSectionChart, UsersDynamicsChart } from './client'
import { HealthBannerView } from './health-banner'
import { MetricCard } from './metric-card'
import { PeriodTabs } from './period-tabs'

// Operational metrics page для оператора платформы.
// Plan: docs/plans/admin-dashboard.md.
//
// SSR с force-dynamic — каждый F5 запускает 15 queries (9 metrics +
// 4 sparklines + funnel + users-dynamics) для свежего среза.
//
// Naming follows docs/content-style.md §"Дашборд → Сводка/Метрики":
// nav label is "Метрики" (existing /admin landing already uses "Сводка").

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Метрики — Админка LevelChannel',
}

type PageProps = {
  searchParams: Promise<{ period?: string }>
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const period = parsePeriodOrDefault(sp.period)

  let data: DashboardData
  try {
    data = await loadDashboardData(period)
  } catch (e) {
    return (
      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Метрики</h1>
        <PeriodTabs active={period} />
        <div
          role="alert"
          style={{
            padding: 16,
            background: 'rgba(208,74,46,0.15)',
            border: '1px solid #d04a2e',
            color: '#ff8a8a',
            borderRadius: 10,
          }}
        >
          Ошибка загрузки данных: {e instanceof Error ? e.message : String(e)}
        </div>
      </main>
    )
  }

  const { metrics, sparklines, funnel, usersDynamics, health } = data
  const showDelta = metrics.period !== 'all'
  const completed = metrics.lessonsCompleted.current
  const noShowSum =
    metrics.noShowTeacher.current + metrics.noShowLearner.current + completed
  const noShowDenom = noShowSum > 0 ? noShowSum : undefined

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 16,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Метрики</h1>
        <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
          обновлено {new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
        </span>
      </div>

      <HealthBannerView banner={health} />
      <PeriodTabs active={metrics.period} />

      <section
        aria-label="Метрики"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          marginBottom: 32,
        }}
      >
        <MetricCard
          label="Активные учителя"
          value={metrics.activeTeachers}
          showDelta={showDelta}
        />
        <MetricCard
          label="Активные ученики"
          value={metrics.activeLearners}
          showDelta={showDelta}
        />
        <MetricCard
          label="Слотов создано"
          value={metrics.slotsCreated}
          sparkline={sparklines.slotsCreated.buckets}
          showDelta={showDelta}
          drillHref="/admin/slots"
        />
        <MetricCard
          label="Слотов забронировано"
          value={metrics.slotsBooked}
          sparkline={sparklines.slotsBooked.buckets}
          showDelta={showDelta}
          drillHref="/admin/slots?status=booked"
        />
        <MetricCard
          label="Занятий проведено"
          value={metrics.lessonsCompleted}
          sparkline={sparklines.lessonsCompleted.buckets}
          showDelta={showDelta}
          drillHref="/admin/slots?status=completed"
        />
        <MetricCard
          label="Отменено"
          value={metrics.cancelled}
          sparkline={sparklines.cancelled.buckets}
          showDelta={showDelta}
          drillHref="/admin/slots?status=cancelled"
        />
        <MetricCard
          label="Не пришёл (учит.)"
          value={metrics.noShowTeacher}
          rateDenominator={noShowDenom}
          showDelta={showDelta}
          drillHref="/admin/slots?status=no_show_teacher"
        />
        <MetricCard
          label="Не пришёл (учащ.)"
          value={metrics.noShowLearner}
          rateDenominator={noShowDenom}
          showDelta={showDelta}
          drillHref="/admin/slots?status=no_show_learner"
        />
        <MetricCard
          label="Не отмечены, прошло время"
          value={metrics.forgottenBookings}
          showDelta={false}
          drillHref="/admin/slots?status=booked"
        />
      </section>

      <section
        aria-label="Конверсия слотов"
        style={{
          padding: 16,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Конверсия: создано → забронировано → прошло время → проведено
        </h2>
        <FunnelSectionChart funnel={funnel} />
      </section>

      <section
        aria-label="Динамика пользователей"
        style={{
          padding: 16,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Динамика пользователей
        </h2>
        <UsersDynamicsChart dynamics={usersDynamics} />
      </section>
    </main>
  )
}
