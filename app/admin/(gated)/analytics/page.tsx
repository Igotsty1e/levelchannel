import Link from 'next/link'

import { getDbPool } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PAGE_SIZE = 100

type SearchParams = Promise<{
  account?: string
  event?: string
  url?: string
  from?: string
  to?: string
  cursor?: string
}>

type EventRow = {
  occurred_at: Date
  event_id: string
  event_name: string
  anonymous_id: string
  account_id: string | null
  session_id: string
  url: string | null
  ua_family: string | null
  ua_device: string | null
  properties: Record<string, unknown>
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return fmtDate(d)
}

function defaultTo(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return fmtDate(d)
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const account = sp.account?.trim() || null
  const event = sp.event?.trim() || null
  const urlFilter = sp.url?.trim() || null
  const from = sp.from?.trim() || defaultFrom()
  const to = sp.to?.trim() || defaultTo()
  const cursor = sp.cursor || null

  const pool = getDbPool()
  const filters: string[] = ['occurred_at >= $1::timestamptz', 'occurred_at < $2::timestamptz']
  const params: unknown[] = [from, to]
  if (account) {
    params.push(account)
    filters.push(`account_id = $${params.length}::uuid`)
  }
  if (event) {
    params.push(event)
    filters.push(`event_name = $${params.length}`)
  }
  if (urlFilter) {
    params.push(`%${urlFilter}%`)
    filters.push(`url ilike $${params.length}`)
  }
  if (cursor) {
    // Cursor format: "<isoTimestamp>|<event_uuid>"
    const [cTime, cId] = cursor.split('|')
    if (cTime && cId) {
      params.push(cTime)
      params.push(cId)
      filters.push(
        `(occurred_at, event_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      )
    }
  }

  const sql = `select occurred_at, event_id, event_name, anonymous_id, account_id,
                      session_id, url, ua_family, ua_device, properties
                 from events
                where ${filters.join(' and ')}
             order by occurred_at desc, event_id desc
                limit ${PAGE_SIZE + 1}`

  let rows: EventRow[] = []
  let totalEstimate: number | null = null
  let error: string | null = null
  try {
    const result = await pool.query<EventRow>(sql, params)
    rows = result.rows
    // Cheap estimate via pg_stat without full count (для крупных таблиц).
    const est = await pool.query<{ estimate: number }>(
      `select coalesce(reltuples, 0)::bigint as estimate
         from pg_class
        where relname = 'events'`,
    )
    totalEstimate = est.rows[0]?.estimate ?? null
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const hasNext = rows.length > PAGE_SIZE
  const visible = rows.slice(0, PAGE_SIZE)
  const nextCursor = hasNext
    ? `${visible[visible.length - 1].occurred_at.toISOString()}|${visible[visible.length - 1].event_id}`
    : null

  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px', color: 'var(--text)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Аналитика — события</h1>
        <div style={{ fontSize: 13, color: 'var(--secondary)' }}>
          {totalEstimate ? `~${totalEstimate.toLocaleString('ru-RU')} всего` : '—'}
        </div>
      </header>

      {/* Filter form */}
      <form
        method="get"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
          padding: 16,
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <label style={{ display: 'block', fontSize: 12 }}>
          От
          <input type="date" name="from" defaultValue={from} style={inputStyle} />
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>
          До
          <input type="date" name="to" defaultValue={to} style={inputStyle} />
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>
          Account ID
          <input type="text" name="account" placeholder="uuid" defaultValue={account ?? ''} style={inputStyle} />
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>
          Event name
          <input
            type="text"
            name="event"
            placeholder="page_view, hero_cta_clicked, ..."
            defaultValue={event ?? ''}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>
          URL contains
          <input type="text" name="url" placeholder="/saas/learn" defaultValue={urlFilter ?? ''} style={inputStyle} />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button type="submit" style={btnStyle}>
            Применить
          </button>
          <Link href="/admin/analytics" style={{ ...btnStyle, background: 'transparent', color: 'var(--text)' }}>
            Сбросить
          </Link>
        </div>
      </form>

      {error ? (
        <div style={{ padding: 12, border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)', marginBottom: 16 }}>
          Ошибка: {error}
        </div>
      ) : null}

      {totalEstimate != null && totalEstimate < 100 ? (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--secondary)', marginBottom: 16, fontSize: 13 }}>
          Пока недостаточно данных для воронок и cohort-анализа (&lt; 100 событий). События только начали поступать —
          копим до содержательного объёма.
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--card)' }}>
              <th style={thStyle}>Время</th>
              <th style={thStyle}>Событие</th>
              <th style={thStyle}>URL</th>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Anon</th>
              <th style={thStyle}>Device</th>
              <th style={thStyle}>Props</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--secondary)' }}>
                  Нет событий по фильтру
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.event_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{fmtTime(new Date(r.occurred_at))}</td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12 }}>{r.event_name}</code>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.url ?? '—'}
                  </td>
                  <td style={tdStyle}>
                    {r.account_id ? (
                      <Link href={`/admin/analytics?account=${r.account_id}`} style={{ color: 'var(--accent)' }}>
                        {r.account_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span style={{ color: 'var(--secondary)' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 11, color: 'var(--secondary)' }}>{r.anonymous_id.slice(0, 8)}…</code>
                  </td>
                  <td style={tdStyle}>
                    {r.ua_family ?? '—'} / {r.ua_device ?? '—'}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 280 }}>
                    <code style={{ fontSize: 11, color: 'var(--secondary)' }}>
                      {Object.keys(r.properties).length > 0
                        ? JSON.stringify(r.properties).slice(0, 80)
                        : '—'}
                    </code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link
            href={`/admin/analytics?${new URLSearchParams({
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
              ...(account ? { account } : {}),
              ...(event ? { event } : {}),
              ...(urlFilter ? { url: urlFilter } : {}),
              cursor: nextCursor,
            }).toString()}`}
            style={btnStyle}
          >
            Дальше →
          </Link>
        </div>
      ) : null}

      <details style={{ marginTop: 32, fontSize: 13, color: 'var(--secondary)' }}>
        <summary style={{ cursor: 'pointer' }}>SQL-рецепты + admin tips</summary>
        <p style={{ marginTop: 8 }}>
          • Воронки/retention/attribution — в <code>docs/analytics/queries.sql</code> (10 готовых
          запросов).
        </p>
        <p>
          • Каталог 30+ событий — <code>docs/analytics/events.md</code>.
        </p>
        <p>
          • Identity model — <code>docs/analytics/identification.md</code>.
        </p>
        <p>
          • Для user timeline — кликни по Account ID в таблице.
        </p>
        <p>
          • ⚠️ Все запросы к <code>events</code> должны фильтровать <code>occurred_at</code> для
          partition pruning.
        </p>
      </details>
    </main>
  )
}

const inputStyle = {
  width: '100%',
  marginTop: 4,
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
}

const btnStyle = {
  display: 'inline-block',
  padding: '8px 16px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--accent)',
  color: '#fff',
  textDecoration: 'none',
  cursor: 'pointer',
  fontSize: 13,
}

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--secondary)',
}

const tdStyle = {
  padding: '8px 12px',
  verticalAlign: 'top' as const,
}
