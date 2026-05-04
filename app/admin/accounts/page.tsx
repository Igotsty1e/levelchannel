import Link from 'next/link'

import { listAccounts } from '@/lib/auth/accounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PAGE_SIZE = 50

type SearchParams = Promise<{ q?: string; page?: string }>

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 80)
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const offset = (page - 1) * PAGE_SIZE

  const { accounts, total } = await listAccounts({
    search: q,
    limit: PAGE_SIZE,
    offset,
  })
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        Аккаунты
      </h1>

      <form
        method="GET"
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Поиск по e-mail"
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            color: 'var(--text)',
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Искать
        </button>
      </form>

      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 12 }}>
        Всего: {total}
      </p>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr
              style={{
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--secondary)',
                textAlign: 'left',
              }}
            >
              <th style={{ padding: '10px 14px' }}>E-mail</th>
              <th style={{ padding: '10px 14px' }}>Подтверждён</th>
              <th style={{ padding: '10px 14px' }}>Статус</th>
              <th style={{ padding: '10px 14px' }}>Создан</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acct) => (
              <tr key={acct.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px' }}>
                  <Link
                    href={`/admin/accounts/${acct.id}`}
                    style={{ color: 'var(--text)' }}
                  >
                    {acct.email}
                  </Link>
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--secondary)' }}>
                  {acct.emailVerifiedAt ? 'да' : '—'}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--secondary)' }}>
                  {acct.purgedAt
                    ? 'удалён'
                    : acct.scheduledPurgeAt
                      ? `удаление ${formatDate(acct.scheduledPurgeAt)}`
                      : acct.disabledAt
                        ? 'отключён'
                        : 'активен'}
                </td>
                <td style={{ padding: '10px 14px', color: 'var(--secondary)' }}>
                  {formatDate(acct.createdAt)}
                </td>
              </tr>
            ))}
            {accounts.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '24px 14px',
                    textAlign: 'center',
                    color: 'var(--secondary)',
                  }}
                >
                  Ничего не найдено.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {lastPage > 1 ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 16,
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          {page > 1 ? (
            <PaginationLink q={q} page={page - 1}>
              ← Назад
            </PaginationLink>
          ) : null}
          <span style={{ color: 'var(--secondary)' }}>
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <PaginationLink q={q} page={page + 1}>
              Вперёд →
            </PaginationLink>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function PaginationLink({
  q,
  page,
  children,
}: {
  q: string
  page: number
  children: string
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  params.set('page', String(page))
  return (
    <Link
      href={`/admin/accounts?${params.toString()}`}
      style={{ color: 'var(--text)' }}
    >
      {children}
    </Link>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU')
}
