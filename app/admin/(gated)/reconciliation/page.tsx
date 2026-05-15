import Link from 'next/link'

import { listPaidNotGrantedOrders } from '@/lib/billing/paid-not-granted'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PKG-RECON RECON.1 — operator queue for paid_not_granted orders.
//
// Each row is a CloudPayments-paid package order whose grant-flow
// hit one of the 7 semantic failures (lib/billing/package-grant.ts)
// and left the system without a corresponding package_purchases row.
// deletion-guard blocks account deletion for the learner until the
// operator resolves the case here.
//
// Actions land in RECON.2-4:
//   - Re-run grant (RECON.2)
//   - Attach to a different account (RECON.3)
//   - Mark resolved (RECON.4)
//
// This page renders the list + a "Действия (скоро)" placeholder
// column; the action buttons will be wired in their respective
// follow-up PRs.

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortInvoiceId(id: string): string {
  if (id.length <= 16) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

export default async function ReconciliationPage() {
  // Auth: parent (gated) layout already enforces admin role. No extra
  // guard needed at the page-server level.
  const result = await listPaidNotGrantedOrders({ limit: 100 })

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Реконсилиация: paid_not_granted пакеты
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 24,
          maxWidth: 720,
        }}
      >
        Сюда попадают заказы пакетов, которые оплачены через CloudPayments,
        но grant-flow не смог их закрепить за учеником (семь причин
        перечислены в <code>lib/billing/package-grant.ts</code>). До
        ручного разрешения такой заказ блокирует удаление аккаунта
        (deletion-guard). Действия (повторить grant, привязать к
        другому аккаунту, отметить как закрытый вручную) появятся в
        ближайших PR; пока — read-only список.
      </p>

      <Section
        title={`Очередь (${result.total} ${result.total === 1 ? 'заказ' : 'заказов'})`}
      >
        {result.rows.length === 0 ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              padding: '12px 0',
            }}
          >
            Очередь пустая — все оплаченные пакеты успешно выданы.
          </p>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>Invoice</Th>
                <Th>Оплачен</Th>
                <Th align="right">Сумма</Th>
                <Th>E-mail клиента</Th>
                <Th>metadata.accountId</Th>
                <Th>Last failure</Th>
                <Th>Пакет</Th>
                <Th>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const mismatch =
                  row.metaAccountId !== null
                  && row.emailAccountId !== null
                  && row.metaAccountId !== row.emailAccountId
                return (
                  <tr
                    key={row.invoiceId}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <Td>
                      <Link
                        href={`/admin/payments/${encodeURIComponent(row.invoiceId)}`}
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: 'var(--accent)',
                          textDecoration: 'none',
                        }}
                      >
                        {shortInvoiceId(row.invoiceId)}
                      </Link>
                    </Td>
                    <Td>{formatDateTime(row.paidAt)}</Td>
                    <Td align="right">
                      {new Intl.NumberFormat('ru-RU').format(row.amountRub)}{' '}
                      ₽
                    </Td>
                    <Td>
                      <code style={{ fontSize: 11 }}>
                        {row.customerEmail ?? '—'}
                      </code>
                    </Td>
                    <Td>
                      <code style={{ fontSize: 11 }}>
                        {row.metaAccountEmail
                          ?? (row.metaAccountId
                            ? `${row.metaAccountId.slice(0, 8)}…`
                            : '—')}
                      </code>
                      {mismatch ? (
                        <span
                          style={{
                            display: 'block',
                            color: '#ff8a8a',
                            fontSize: 11,
                            marginTop: 2,
                          }}
                          title="metadata.accountId и customer_email resolved to different accounts"
                        >
                          ⚠ mismatch
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <code style={{ fontSize: 11 }}>
                        {row.lastFailureReason ?? '—'}
                      </code>
                    </Td>
                    <Td>
                      <code style={{ fontSize: 11 }}>
                        {row.metaPackageSlug ?? '—'}
                      </code>
                    </Td>
                    <Td>
                      <span
                        style={{
                          color: 'var(--secondary)',
                          fontSize: 11,
                        }}
                      >
                        скоро (RECON.2-4)
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 12,
          color: 'var(--secondary)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
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
        fontSize: 11,
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

