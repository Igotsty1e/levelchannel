import Link from 'next/link'

import { getDbPool } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — admin multi-teacher overview.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 6 + §5 Day 6.
//
// Columns: email, plan_slug, learner_count, current_balance,
// last_active_at. Counts joined via LEFT JOIN to keep teachers with
// zero learners / zero earnings visible.
//
// The (gated) layout guards admin role + redirects anonymous to
// /admin/login, so we don't re-check here — no double session lookup.

type TeacherRow = {
  accountId: string
  email: string
  planSlug: string | null
  state: string | null
  publicSlug: string | null
  learnerCount: number
  currentBalanceKopecks: number
  lastActiveAt: string | null
}

async function listTeachersForAdmin(): Promise<TeacherRow[]> {
  const pool = getDbPool()
  // Single query — join accounts → account_roles (teacher) →
  // teacher_subscriptions → derived learner_count → derived balance →
  // last_active_at via greatest(session.last_used_at, last mark).
  const result = await pool.query<{
    account_id: string
    email: string
    plan_slug: string | null
    state: string | null
    public_slug: string | null
    learner_count: string
    balance_kopecks: string
    last_active_at: string | null
  }>(
    `with teacher_accounts as (
       select a.id as account_id, a.email
         from accounts a
         join account_roles r on r.account_id = a.id and r.role = 'teacher'
        where a.scheduled_purge_at is null
     ),
     learners as (
       select t.account_id, count(*)::int as c
         from teacher_accounts t
         left join learner_teacher_links l
                on l.teacher_account_id = t.account_id
               and l.unlinked_at is null
        group by t.account_id
     ),
     balances as (
       select t.account_id,
              coalesce(sum(e.amount_net * 100), 0)::bigint as balance_kopecks
         from teacher_accounts t
         left join teacher_earnings e on e.teacher_account_id = t.account_id
        group by t.account_id
     ),
     activity as (
       select t.account_id,
              max(s.last_used_at) as last_session_at
         from teacher_accounts t
         left join account_sessions s on s.account_id = t.account_id
        group by t.account_id
     )
     select t.account_id,
            t.email,
            sub.plan_slug,
            sub.state,
            p.teacher_public_slug as public_slug,
            coalesce(l.c, 0)::text as learner_count,
            coalesce(b.balance_kopecks, 0)::text as balance_kopecks,
            a.last_session_at::text as last_active_at
       from teacher_accounts t
       left join teacher_subscriptions sub on sub.account_id = t.account_id
       left join account_profiles p on p.account_id = t.account_id
       left join learners l on l.account_id = t.account_id
       left join balances b on b.account_id = t.account_id
       left join activity a on a.account_id = t.account_id
      order by t.email asc`,
  )
  return result.rows.map((row) => ({
    accountId: row.account_id,
    email: row.email,
    planSlug: row.plan_slug,
    state: row.state,
    publicSlug: row.public_slug,
    learnerCount: Number(row.learner_count) || 0,
    currentBalanceKopecks: Number(row.balance_kopecks) || 0,
    lastActiveAt: row.last_active_at,
  }))
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(kopecks / 100)) + ' ₽'
}

function formatTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  mid: 'Mid',
  pro: 'Pro',
  'operator-managed': 'Plan-4 (operator)',
}

export default async function AdminTeachersPage() {
  const rows = await listTeachersForAdmin()

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
        Учителя
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Все аккаунты с ролью «учитель» — статус подписки, количество
        учеников, текущий баланс и последняя активность сессии.
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
              <th style={th}>Тариф</th>
              <th style={th}>Состояние</th>
              <th style={th}>Slug</th>
              <th style={th}>Учеников</th>
              <th style={th}>Баланс</th>
              <th style={th}>Последняя активность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.accountId}
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <td style={td}>
                  <Link
                    href={`/admin/teachers/${encodeURIComponent(t.accountId)}`}
                    style={{ color: 'var(--text)' }}
                  >
                    {t.email}
                  </Link>
                </td>
                <td style={td}>
                  {t.planSlug ? PLAN_LABEL[t.planSlug] ?? t.planSlug : '—'}
                </td>
                <td style={tdSecondary}>{t.state ?? '—'}</td>
                <td style={tdSecondary}>
                  {t.publicSlug ? (
                    <code style={{ fontSize: 12 }}>{t.publicSlug}</code>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={td}>{t.learnerCount}</td>
                <td style={td}>{formatRub(t.currentBalanceKopecks)}</td>
                <td style={tdSecondary}>{formatTs(t.lastActiveAt)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: '24px 14px',
                    textAlign: 'center',
                    color: 'var(--secondary)',
                  }}
                >
                  Пока нет учителей.
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
