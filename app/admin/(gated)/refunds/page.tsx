import Link from 'next/link'

import { listRecentReversals } from '@/lib/billing/reversals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Wave 64 — admin refunds listing. Read-only operator visibility into
// `payment_allocation_reversals`. Mirrors `/admin/debt-summary` shape.

function formatRub(kopecks: number): string {
  return (kopecks / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string; offset?: string }>
}) {
  const sp = await searchParams
  const limitRaw = Number(sp.limit ?? '50')
  const offsetRaw = Number(sp.offset ?? '0')
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 500)
      : 50
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0

  const rows = await listRecentReversals({ limit, offset })
  const nextOffset = rows.length === limit ? offset + limit : null
  const prevOffset = offset > 0 ? Math.max(0, offset - limit) : null

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>
        Возвраты
      </h1>

      <p style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 16 }}>
        Журнал возвратов и сторно — каждая строка показывает, что
        конкретно вернулось ученику: оплата за конкретное занятие,
        списание из пакета или возврат за весь пакет. Сами деньги
        отправляются назад на карту ученика через CloudPayments —
        либо вручную из панели оператора, либо автоматически. Эта
        таблица показывает уже состоявшиеся возвраты, новые — сверху.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--secondary)' }}>
          Возвратов пока нет{offset > 0 ? ' на этой странице' : ''}.
        </p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <Th>Когда</Th>
              <Th>Заказ</Th>
              <Th>Тип возврата</Th>
              <Th>На что (ID)</Th>
              <Th align="right">Сумма, ₽</Th>
              <Th>Оператор</Th>
              <Th>Причина</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <Td>
                  <span style={{ color: 'var(--secondary)' }}>
                    {formatDate(r.createdAt)}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={`/admin/payments/${encodeURIComponent(r.paymentOrderId)}`}
                    style={{ color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }}
                  >
                    {r.paymentOrderId}
                  </Link>
                </Td>
                <Td>{r.kind}</Td>
                <Td>
                  <code style={{ fontSize: 12 }}>{r.targetId.slice(0, 8)}…</code>
                </Td>
                <Td align="right">
                  <strong>{formatRub(r.refundedKopecks)}</strong>
                </Td>
                <Td>
                  <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                    {r.refundedByEmail ?? r.refundedByAccountId.slice(0, 8) + '…'}
                  </span>
                </Td>
                <Td>
                  {r.reason ? (
                    <span style={{ fontSize: 13 }}>{r.reason}</span>
                  ) : (
                    <span style={{ color: 'var(--secondary)' }}>—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div
        style={{
          display: 'flex',
          gap: 12,
          marginTop: 16,
          alignItems: 'center',
          fontSize: 13,
          color: 'var(--secondary)',
        }}
      >
        <span>limit={limit}, offset={offset}, показано {rows.length}</span>
        {prevOffset !== null ? (
          <Link
            href={`/admin/refunds?limit=${limit}&offset=${prevOffset}`}
            style={{ color: 'var(--text)' }}
          >
            ← назад
          </Link>
        ) : null}
        {nextOffset !== null ? (
          <Link
            href={`/admin/refunds?limit=${limit}&offset=${nextOffset}`}
            style={{ color: 'var(--text)' }}
          >
            вперёд →
          </Link>
        ) : null}
      </div>
    </>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      style={{
        padding: '8px 12px',
        fontWeight: 600,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: 'var(--secondary)',
        textAlign: align,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <td
      style={{
        padding: '10px 12px',
        textAlign: align,
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  )
}
