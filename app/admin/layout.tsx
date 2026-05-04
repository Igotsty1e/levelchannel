import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

// Shared admin chrome. Server-renders on every request, gates on the
// session cookie + admin role. Anonymous → /login; logged-in non-admin
// → /cabinet (we don't surface the existence of /admin to non-admins).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Админка — LevelChannel',
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null

  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }

  const roles = await listAccountRoles(current.account.id)
  if (!roles.includes('admin')) {
    redirect('/cabinet')
  }

  return (
    <>
      <SiteHeader />
      <div
        style={{
          display: 'flex',
          minHeight: 'calc(100vh - 56px)',
          background: 'var(--bg)',
        }}
      >
        <aside
          style={{
            width: 240,
            padding: '24px 16px',
            borderRight: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 12,
            }}
          >
            Админка
          </p>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <AdminNavLink href="/admin">Дашборд</AdminNavLink>
            <AdminNavLink href="/admin/accounts">Аккаунты</AdminNavLink>
            <AdminNavLink href="/admin/pricing">Тарифы</AdminNavLink>
            <AdminNavLink href="/admin/slots">Слоты</AdminNavLink>
            <AdminNavLink href="/admin/payments">Платежи</AdminNavLink>
          </nav>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 12,
              marginTop: 32,
              lineHeight: 1.5,
            }}
          >
            Вход как<br />
            <span style={{ color: 'var(--text)' }}>{current.account.email}</span>
          </p>
        </aside>
        <main style={{ flex: 1, padding: '32px 40px 96px', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </>
  )
}

function AdminNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '8px 12px',
        borderRadius: 6,
        color: 'var(--text)',
        fontSize: 14,
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}
