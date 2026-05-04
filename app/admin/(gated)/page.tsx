import Link from 'next/link'

import { listAccounts } from '@/lib/auth/accounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AdminDashboardPage() {
  const { total } = await listAccounts({ limit: 1, offset: 0 })

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>
        Дашборд
      </h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <Card title="Всего аккаунтов" value={String(total)} href="/admin/accounts" />
        <Card title="Тарифы" value="управление" href="/admin/pricing" />
      </div>
      <p style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.6 }}>
        Расширенные дашборды (платежи, регистрации за неделю, отказы)
        запланированы в P2 — `ENGINEERING_BACKLOG.md`.
      </p>
    </>
  )
}

function Card({
  title,
  value,
  href,
}: {
  title: string
  value: string
  href: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: 20,
        border: '1px solid var(--border)',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </Link>
  )
}
