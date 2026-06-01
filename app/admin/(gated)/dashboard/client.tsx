'use client'

// Recharts client wrappers — все chart canvas-рендеры. Data приходит prop'ами
// от SSR родителей (`page.tsx`, `metric-card.tsx`, `funnel-section.tsx`).
//
// Plan: docs/plans/admin-dashboard.md §Tech stack — Recharts split SSR/client.

import {
  Area,
  AreaChart,
  CartesianGrid,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type {
  BucketPoint,
  DashboardFunnel,
  DashboardUsersDynamics,
} from '@/lib/admin/dashboard-types'

export function Sparkline({ data }: { data: BucketPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--secondary)', fontSize: 11, padding: '4px 0' }}>
        нет данных
      </div>
    )
  }
  const chartData = data.map((d) => ({ bucket: d.bucket, value: d.value }))
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent, #b67220)"
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function FunnelSectionChart({ funnel }: { funnel: DashboardFunnel }) {
  const data = [
    { name: 'Создано', value: funnel.created, fill: '#5c8a6a' },
    { name: 'Забронировано', value: funnel.booked, fill: '#3a6a4a' },
    { name: 'Прошло время', value: funnel.pastStart, fill: '#7a6a3a' },
    { name: 'Проведено', value: funnel.completed, fill: '#2a4a3a' },
  ]
  return (
    <ResponsiveContainer width="100%" height={280}>
      <FunnelChart>
        <Tooltip />
        <Funnel dataKey="value" data={data} isAnimationActive={false}>
          <LabelList
            position="right"
            fill="var(--text)"
            stroke="none"
            dataKey="name"
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  )
}

export function UsersDynamicsChart({
  dynamics,
}: {
  dynamics: DashboardUsersDynamics
}) {
  if (dynamics.buckets.length === 0) {
    return (
      <div style={{ color: 'var(--secondary)', fontSize: 13, padding: 16 }}>
        Нет данных за выбранный период.
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={dynamics.buckets}
        margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="bucket"
          tickFormatter={(v: string) => v.slice(5, 10).replace('-', '.')}
          stroke="var(--secondary)"
          fontSize={11}
        />
        <YAxis allowDecimals={false} stroke="var(--secondary)" fontSize={11} />
        <Tooltip
          labelFormatter={(v) => (typeof v === 'string' ? v.slice(0, 10) : String(v ?? ''))}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="teachers"
          name="Учителя"
          stackId="1"
          stroke="#5c8a6a"
          fill="#5c8a6a"
          fillOpacity={0.6}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="learners"
          name="Ученики"
          stackId="1"
          stroke="#b67220"
          fill="#b67220"
          fillOpacity={0.6}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
