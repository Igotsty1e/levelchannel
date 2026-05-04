import Link from 'next/link'

import { listPaymentOrdersForAdmin } from '@/lib/payments/admin-list'
import type { PaymentStatus } from '@/lib/payments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PAGE_SIZE = 50

const STATUSES: Array<PaymentStatus | 'all'> = [
  'all',
  'pending',
  'paid',
  'failed',
  'cancelled',
]

const STATUS_LABEL: Record<PaymentStatus | 'all', string> = {
  all: 'все',
  pending: 'ожидают',
  paid: 'оплачены',
  failed: 'отказ',
  cancelled: 'отменены',
}

type SearchParams = Promise<{
  status?: string
  q?: string
  page?: string
}>

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const statusRaw = sp.status as PaymentStatus | 'all' | undefined
  const status: PaymentStatus | 'all' =
    statusRaw && STATUSES.includes(statusRaw) ? statusRaw : 'all'
  const q = (sp.q ?? '').slice(0, 80)
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const offset = (page - 1) * PAGE_SIZE

  const { orders, total } = await listPaymentOrdersForAdmin({
    status,
    email: q || undefined,
    limit: PAGE_SIZE,
    offset,
  })
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Платежи
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Все ордеры — и из <code>/pay</code> (свободная сумма), и из{' '}
        <code>/checkout/&lt;тариф&gt;</code>. Колонка «Слот» заполнена,
        если платёж был привязан к бронированию.
      </p>

      <form
        method="GET"
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <select
          name="status"
          defaultValue={status}
          style={selectStyle}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={q}
          placeholder="Поиск по e-mail"
          style={inputStyle}
        />
        <button type="submit" style={primaryBtnStyle}>
          Применить
        </button>
        {(status !== 'all' || q) ? (
          <Link href="/admin/payments" style={ghostLinkStyle}>
            Сбросить
          </Link>
        ) : null}
      </form>

      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 12 }}>
        Найдено: {total}
      </p>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
        >
          <thead>
            <tr
              style={{
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--secondary)',
                textAlign: 'left',
              }}
            >
              <th style={th}>Создан</th>
              <th style={th}>Invoice</th>
              <th style={th}>E-mail</th>
              <th style={th}>Сумма</th>
              <th style={th}>Статус</th>
              <th style={th}>Слот</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.invoiceId} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={td}>{formatDateTime(o.createdAt)}</td>
                <td style={td}>
                  <Link
                    href={`/admin/payments/${encodeURIComponent(o.invoiceId)}`}
                    style={{ color: 'var(--text)', fontFamily: 'monospace' }}
                  >
                    {o.invoiceId}
                  </Link>
                </td>
                <td style={tdSecondary}>{o.customerEmail}</td>
                <td style={td}>
                  {new Intl.NumberFormat('ru-RU').format(o.amountRub)}\u00a0₽
                </td>
                <td style={td}>{STATUS_LABEL[o.status] ?? o.status}</td>
                <td style={tdSecondary}>
                  {o.slotId ? (
                    <code style={{ fontSize: 10 }}>
                      {o.slotId.slice(0, 8)}…
                    </code>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
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
            <PaginationLink status={status} q={q} page={page - 1}>
              ← Назад
            </PaginationLink>
          ) : null}
          <span style={{ color: 'var(--secondary)' }}>
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <PaginationLink status={status} q={q} page={page + 1}>
              Вперёд →
            </PaginationLink>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function PaginationLink({
  status,
  q,
  page,
  children,
}: {
  status: string
  q: string
  page: number
  children: string
}) {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('status', status)
  if (q) params.set('q', q)
  params.set('page', String(page))
  return (
    <Link
      href={`/admin/payments?${params.toString()}`}
      style={{ color: 'var(--text)' }}
    >
      {children}
    </Link>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
  minWidth: 200,
}

const selectStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
}

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
}

const ghostLinkStyle: React.CSSProperties = {
  padding: '8px 14px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
  color: 'var(--text)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
}

const th: React.CSSProperties = { padding: '8px 12px' }
const td: React.CSSProperties = { padding: '8px 12px' }
const tdSecondary: React.CSSProperties = {
  padding: '8px 12px',
  color: 'var(--secondary)',
}
