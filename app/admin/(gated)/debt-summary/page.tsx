import Link from 'next/link'

import { listAccountsWithPostpaidDebtAggregate } from '@/lib/billing/packages'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Wave 58 — admin debt summary page. Renders the aggregated postpaid
// debt across all learners. The CSV export link hits the same endpoint
// with `format=csv` for offline follow-up.

function formatRub(kopecks: number): string {
  const rub = kopecks / 100
  return rub.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function AdminDebtSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ minKopecks?: string }>
}) {
  const sp = await searchParams
  const minKopecks = Number(sp.minKopecks ?? '0')
  const minK = Number.isFinite(minKopecks) && minKopecks >= 0 ? Math.floor(minKopecks) : 0

  const rows = await listAccountsWithPostpaidDebtAggregate({ minKopecks: minK })
  const totalDebt = rows.reduce((s, r) => s + r.totalDebtKopecks, 0)

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>
        Задолженности учеников
      </h1>

      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <Stat label="Аккаунтов с долгом" value={String(rows.length)} />
        <Stat label="Суммарный долг" value={`${formatRub(totalDebt)} ₽`} />
      </div>

      <form
        method="get"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <label
          htmlFor="minKopecks"
          style={{ fontSize: 13, color: 'var(--secondary)' }}
        >
          Порог (₽):
        </label>
        <input
          id="minKopecks"
          name="minKopecks"
          type="number"
          min={0}
          step={100}
          defaultValue={minK > 0 ? String(minK) : ''}
          placeholder="0"
          style={{
            padding: '6px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            width: 120,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '6px 14px',
            background: 'var(--text)',
            color: 'var(--bg)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Применить
        </button>
        <a
          href={`/api/admin/debt-summary?format=csv${minK > 0 ? `&minKopecks=${minK}` : ''}`}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--text)',
            textDecoration: 'none',
            marginLeft: 'auto',
          }}
        >
          Скачать CSV
        </a>
      </form>

      <p style={{ fontSize: 12, color: 'var(--secondary)', marginBottom: 16 }}>
        Порог фильтрует аккаунты, чей суммарный долг ниже указанной суммы (в копейках в URL,
        в рублях в форме). Пустое поле = показывать всех с любым долгом.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--secondary)' }}>
          Никто не должен. {minK > 0 ? 'Попробуйте снизить порог.' : ''}
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
              <Th>Аккаунт</Th>
              <Th>E-mail</Th>
              <Th align="right">Долг, ₽</Th>
              <Th align="right">Занятий</Th>
              <Th>Старший долг</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.accountId}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <Td>
                  <Link
                    href={`/admin/accounts/${r.accountId}`}
                    style={{ color: 'var(--text)' }}
                  >
                    {r.displayName ?? '—'}
                  </Link>
                </Td>
                <Td>
                  <span style={{ color: 'var(--secondary)' }}>{r.email}</span>
                </Td>
                <Td align="right">
                  <strong>{formatRub(r.totalDebtKopecks)}</strong>
                  {r.slotsWithoutTariff > 0 ? (
                    <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                      {' '}
                      (+{r.slotsWithoutTariff} без тарифа)
                    </span>
                  ) : null}
                </Td>
                <Td align="right">{r.slotCount}</Td>
                <Td>
                  <span style={{ color: 'var(--secondary)' }}>
                    {formatDate(r.oldestDebtSlotAt)}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 8,
        minWidth: 200,
      }}
    >
      <div
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
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
      }}
    >
      {children}
    </td>
  )
}
