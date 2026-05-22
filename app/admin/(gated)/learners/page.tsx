import Link from 'next/link'

import { getDbPool } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — admin global learners list.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 6 + §5 Day 6.
//
// Columns: email, teacher_count (active links), last_active_at (max
// session last_used_at). Admin / teacher / unverified / purged
// accounts are excluded — this surface is only the learner archetype.

type LearnerRow = {
  accountId: string
  email: string
  teacherCount: number
  lastActiveAt: string | null
}

async function listLearnersForAdmin(): Promise<LearnerRow[]> {
  const pool = getDbPool()
  const result = await pool.query<{
    account_id: string
    email: string
    teacher_count: string
    last_active_at: string | null
  }>(
    `with learner_accounts as (
       select a.id, a.email
         from accounts a
        where a.scheduled_purge_at is null
          and a.email_verified_at is not null
          and not exists (
            select 1 from account_roles r
             where r.account_id = a.id
               and r.role in ('admin', 'teacher')
          )
     ),
     link_counts as (
       select la.id as account_id, count(*)::int as c
         from learner_accounts la
         left join learner_teacher_links l
                on l.learner_account_id = la.id
               and l.unlinked_at is null
        group by la.id
     ),
     activity as (
       select la.id as account_id, max(s.last_used_at) as last_used_at
         from learner_accounts la
         left join account_sessions s on s.account_id = la.id
        group by la.id
     )
     select la.id as account_id,
            la.email,
            coalesce(lc.c, 0)::text as teacher_count,
            a.last_used_at::text as last_active_at
       from learner_accounts la
       left join link_counts lc on lc.account_id = la.id
       left join activity a on a.account_id = la.id
      order by la.email asc`,
  )
  return result.rows.map((row) => ({
    accountId: row.account_id,
    email: row.email,
    teacherCount: Number(row.teacher_count) || 0,
    lastActiveAt: row.last_active_at,
  }))
}

function formatTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}

export default async function AdminLearnersPage() {
  const rows = await listLearnersForAdmin()

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Ученики
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Все верифицированные ученики (без admin/teacher ролей) — у скольких
        учителей учатся и когда последний раз заходили.
      </p>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
        >
          <thead>
            <tr
              style={{
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--secondary)',
                textAlign: 'left',
              }}
            >
              <th style={th}>E-mail</th>
              <th style={th}>Учителей</th>
              <th style={th}>Последняя активность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.accountId}
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <td style={td}>
                  <Link
                    href={`/admin/accounts/${encodeURIComponent(l.accountId)}`}
                    style={{ color: 'var(--text)' }}
                  >
                    {l.email}
                  </Link>
                </td>
                <td style={td}>{l.teacherCount}</td>
                <td style={tdSecondary}>{formatTs(l.lastActiveAt)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  style={{
                    padding: '24px 14px',
                    textAlign: 'center',
                    color: 'var(--secondary)',
                  }}
                >
                  Пока нет учеников.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}

const th: React.CSSProperties = { padding: '8px 12px' }
const td: React.CSSProperties = { padding: '8px 12px' }
const tdSecondary: React.CSSProperties = {
  padding: '8px 12px',
  color: 'var(--secondary)',
}
