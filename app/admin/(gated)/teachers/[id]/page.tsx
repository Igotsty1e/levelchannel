import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listAccountRoles } from '@/lib/auth/accounts'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { getDbPool } from '@/lib/db/pool'

import { TeacherEditForm } from './edit-form'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — admin teacher drill-down.
//
// Blocks: subscription history (current row), learners, tariffs,
// packages, earnings ledger summary, edit form (plan + commission +
// slug). Anti-spoof: re-verifies target is actually a teacher (admin
// trying to drill into a learner's id → 404).

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TeacherDetail = {
  accountId: string
  email: string
  planSlug: string | null
  state: string | null
  renewalAt: string | null
  publicSlug: string | null
  displayName: string | null
  firstName: string | null
  lastName: string | null
  commissionRate: number | null
}

async function loadTeacherDetail(
  accountId: string,
): Promise<TeacherDetail | null> {
  if (!UUID_PATTERN.test(accountId)) return null
  const pool = getDbPool()
  const result = await pool.query<{
    email: string
    plan_slug: string | null
    state: string | null
    renewal_at: string | null
    public_slug: string | null
    display_name: string | null
    first_name: string | null
    last_name: string | null
  }>(
    `select a.email,
            sub.plan_slug,
            sub.state,
            sub.renewal_at::text as renewal_at,
            p.teacher_public_slug as public_slug,
            p.display_name,
            p.first_name,
            p.last_name
       from accounts a
       left join teacher_subscriptions sub on sub.account_id = a.id
       left join account_profiles p on p.account_id = a.id
      where a.id = $1::uuid
      limit 1`,
    [accountId],
  )
  const row = result.rows[0]
  if (!row) return null
  // Anti-spoof: target MUST have the teacher role. Drilling into a
  // learner / admin-only / orphan account from /admin/teachers/<id>
  // returns 404 to avoid leaking arbitrary accounts via the path.
  const roles = await listAccountRoles(accountId)
  if (!roles.includes('teacher')) return null
  return {
    accountId,
    email: row.email,
    planSlug: row.plan_slug,
    state: row.state,
    renewalAt: row.renewal_at,
    publicSlug: row.public_slug,
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    commissionRate: null,
  }
}

type LearnerRow = {
  learnerAccountId: string
  email: string
  linkedAt: string
}

async function listLinkedLearners(
  teacherAccountId: string,
): Promise<LearnerRow[]> {
  const pool = getDbPool()
  const result = await pool.query<{
    learner_account_id: string
    email: string
    linked_at: string
  }>(
    `select l.learner_account_id,
            a.email,
            l.linked_at::text as linked_at
       from learner_teacher_links l
       join accounts a on a.id = l.learner_account_id
      where l.teacher_account_id = $1::uuid
        and l.unlinked_at is null
      order by l.linked_at asc`,
    [teacherAccountId],
  )
  return result.rows.map((row) => ({
    learnerAccountId: row.learner_account_id,
    email: row.email,
    linkedAt: row.linked_at,
  }))
}

type TariffRow = { id: string; slug: string; titleRu: string; amountRub: number }

async function listTeacherTariffs(
  teacherAccountId: string,
): Promise<TariffRow[]> {
  const pool = getDbPool()
  const result = await pool.query<{
    id: string
    slug: string
    title_ru: string
    amount_kopecks: string
  }>(
    `select id, slug, title_ru, amount_kopecks::text
       from pricing_tariffs
      where teacher_id = $1::uuid
        and deleted_at is null
      order by slug asc`,
    [teacherAccountId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    titleRu: row.title_ru,
    amountRub: Math.round(Number(row.amount_kopecks) / 100),
  }))
}

type PackageRow = {
  id: string
  slug: string
  titleRu: string
  count: number
  amountRub: number
}

async function listTeacherPackages(
  teacherAccountId: string,
): Promise<PackageRow[]> {
  const pool = getDbPool()
  const result = await pool.query<{
    id: string
    slug: string
    title_ru: string
    count: number
    amount_kopecks: string
  }>(
    `select id, slug, title_ru, count, amount_kopecks::text
       from lesson_packages
      where teacher_id = $1::uuid
        and is_active = true
      order by display_order asc, id asc`,
    [teacherAccountId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    titleRu: row.title_ru,
    count: Number(row.count) || 0,
    amountRub: Math.round(Number(row.amount_kopecks) / 100),
  }))
}

type EarningsSummary = {
  accruedRub: number
  paidOutRub: number
  clawbackRub: number
  balanceRub: number
}

async function loadEarningsSummary(
  teacherAccountId: string,
): Promise<EarningsSummary> {
  const pool = getDbPool()
  const result = await pool.query<{ kind: string; total: string }>(
    `select kind, coalesce(sum(amount_net), 0)::text as total
       from teacher_earnings
      where teacher_account_id = $1::uuid
      group by kind`,
    [teacherAccountId],
  )
  const map = new Map(result.rows.map((r) => [r.kind, Number(r.total) || 0]))
  const accrued = map.get('accrued') ?? 0
  const paidOut = map.get('paid_out') ?? 0
  const clawback = map.get('clawback') ?? 0
  return {
    accruedRub: accrued,
    paidOutRub: paidOut,
    clawbackRub: clawback,
    balanceRub: accrued + paidOut + clawback,
  }
}

export default async function AdminTeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const teacher = await loadTeacherDetail(id)
  if (!teacher) {
    notFound()
  }

  const [learners, tariffs, packages, earnings] = await Promise.all([
    listLinkedLearners(teacher.accountId),
    listTeacherTariffs(teacher.accountId),
    listTeacherPackages(teacher.accountId),
    loadEarningsSummary(teacher.accountId),
  ])

  return (
    <>
      <p style={{ marginBottom: 8 }}>
        <Link href="/admin/teachers" style={{ color: 'var(--secondary)' }}>
          ← К списку учителей
        </Link>
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>
        {teacher.email}
      </h1>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 24 }}>
        {formatProfileNameForRender({
          firstName: teacher.firstName,
          lastName: teacher.lastName,
          displayName: teacher.displayName,
          fallbackEmail: '—',
        })} · slug:{' '}
        {teacher.publicSlug ? (
          <code style={{ fontSize: 12 }}>{teacher.publicSlug}</code>
        ) : (
          '—'
        )}
      </p>

      {/* Edit form: plan + slug. commission_rate is plan-level, not
          per-teacher (round-26 confirmation); the form keeps the field
          read-only for now and the POST surfaces accept future
          extension without re-deploy. */}
      <section style={section}>
        <h2 style={h2}>Подписка и публичный slug</h2>
        <TeacherEditForm
          teacherAccountId={teacher.accountId}
          currentPlanSlug={teacher.planSlug ?? 'free'}
          currentSlug={teacher.publicSlug ?? ''}
        />
      </section>

      <section style={section}>
        <h2 style={h2}>Учеников: {learners.length}</h2>
        {learners.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Нет активных связей.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {learners.map((l) => (
              <li
                key={l.learnerAccountId}
                style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{l.email}</span>
                <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                  с {new Date(l.linkedAt).toLocaleDateString('ru-RU')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Тарифы</h2>
        {tariffs.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Тарифы не заданы.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tariffs.map((t) => (
              <li
                key={t.id}
                style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <code style={{ fontSize: 12 }}>{t.slug}</code> · {t.titleRu}
                </span>
                <span>
                  {new Intl.NumberFormat('ru-RU').format(t.amountRub)} ₽
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Пакеты</h2>
        {packages.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Пакеты не заданы.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {packages.map((p) => (
              <li
                key={p.id}
                style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <code style={{ fontSize: 12 }}>{p.slug}</code> · {p.titleRu}{' '}
                  (×{p.count})
                </span>
                <span>
                  {new Intl.NumberFormat('ru-RU').format(p.amountRub)} ₽
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Заработок (только чтение)</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
          <li style={{ padding: '4px 0' }}>
            Начислено:{' '}
            <strong>
              {new Intl.NumberFormat('ru-RU').format(earnings.accruedRub)} ₽
            </strong>
          </li>
          <li style={{ padding: '4px 0' }}>
            Выплачено:{' '}
            <strong>
              {new Intl.NumberFormat('ru-RU').format(-earnings.paidOutRub)} ₽
            </strong>
          </li>
          <li style={{ padding: '4px 0' }}>
            Возвраты:{' '}
            <strong>
              {new Intl.NumberFormat('ru-RU').format(-earnings.clawbackRub)} ₽
            </strong>
          </li>
          <li
            style={{
              padding: '8px 0',
              borderTop: '1px solid var(--border)',
              marginTop: 4,
            }}
          >
            Текущий баланс:{' '}
            <strong>
              {new Intl.NumberFormat('ru-RU').format(earnings.balanceRub)} ₽
            </strong>
          </li>
        </ul>
      </section>
    </>
  )
}

const section: React.CSSProperties = {
  marginBottom: 28,
  padding: 16,
  border: '1px solid var(--border)',
  borderRadius: 8,
}
const h2: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
}
