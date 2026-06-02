import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminActionButton } from '@/app/admin/(gated)/admin-action-button'
import {
  type AccountRole,
  getAccountById,
  listAccountRoles,
  listAccountsByRole,
  listLearnerCandidates,
} from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { getActiveTeacherIdsForLearner } from '@/lib/auth/teacher-scope'
import { listAccountActivePackages, listAccountPostpaidDebt } from '@/lib/billing/packages'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import { TeacherAssignment } from './teacher-assignment'
import { TeacherLearnersAdmin } from './teacher-learners-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALL_ROLES: AccountRole[] = ['admin', 'teacher', 'student']

type RouteParams = { params: Promise<{ id: string }> }

export default async function AdminAccountDetailPage({ params }: RouteParams) {
  const { id } = await params
  const account = await getAccountById(id)
  if (!account) notFound()

  const [roles, profile, teachers, packages, debt] = await Promise.all([
    listAccountRoles(account.id),
    getAccountProfile(account.id),
    listAccountsByRole('teacher'),
    listAccountActivePackages(account.id),
    listAccountPostpaidDebt(account.id),
  ])

  // Wave 14.1 — admin viewing a teacher account should NOT see the
  // learner-flow blocks (Учитель / Биллинг). Those are about
  // assigning a teacher TO this account and tracking THEIR billing —
  // useless for a teacher. Show learners-list + assign control
  // instead. Hybrid student+teacher accounts still get both.
  const isTeacher = roles.includes('teacher')
  const isStudent = roles.includes('student')
  const isAdmin = roles.includes('admin')
  const isLearnerView = isStudent || (!isTeacher && !isAdmin)

  // Pull teacher-side data only when needed — keep the admin page
  // fast for plain learner profiles.
  const [teacherLearners, learnerCandidatesRaw] = isTeacher
    ? await Promise.all([
        listLearnersForTeacher(account.id),
        listLearnerCandidates(),
      ])
    : [[], []]

  // SAAS-PIVOT Day 2 (2026-05-22) codex-paranoia round-2 WARN #2
  // closure — admin learner drill-down now surfaces the FULL active
  // teacher link set (n:m canonical) not just the legacy single-value
  // alias. Operator reassignment widget still picks ONE teacher (the
  // single-teacher operator semantics are enforced by setAssignedTeacher
  // soft-unlinking other links inside a TX + advisory lock); but the
  // VISIBILITY layer must show every active link so the operator sees
  // the real state. For a learner with multi-link via invite redeem
  // (Q-7 path), the array carries 2+ teachers.
  const activeTeacherIds = isLearnerView
    ? await getActiveTeacherIdsForLearner(account.id)
    : []
  const activeTeacherList = activeTeacherIds
    .map((id) => {
      const teacher = teachers.find((t) => t.id === id)
      return teacher ? { id: teacher.id, email: teacher.email } : null
    })
    .filter((t): t is { id: string; email: string } => t !== null)
  // Eligible candidates to assign = verified non-admin accounts that
  // are NOT already assigned to this teacher AND are not the teacher
  // themselves (the data layer rejects self-assignment via the
  // teacher-role guard, but skip the option in the UI too).
  const alreadyAssigned = new Set(
    teacherLearners.filter((l) => l.isAssigned).map((l) => l.learnerId),
  )
  const learnerCandidates = learnerCandidatesRaw.filter(
    (c) => c.id !== account.id && !alreadyAssigned.has(c.id),
  )

  return (
    <>
      <p style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/admin/accounts" style={{ color: 'var(--secondary)' }}>
          ← К списку
        </Link>
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        {account.email}
      </h1>

      {account.purgedAt ? (
        <Banner tone="muted">
          Учётная запись удалена {formatDateTime(account.purgedAt)}. Данные
          обезличены, история платежей сохранена в соответствии с 54-ФЗ.
        </Banner>
      ) : account.scheduledPurgeAt ? (
        <Banner tone="warn">
          Запрошено удаление. Анонимизация запланирована на{' '}
          {formatDateTime(account.scheduledPurgeAt)}.{' '}
          <AdminActionButton
            endpoint={`/api/admin/accounts/${account.id}/cancel-deletion`}
            confirmText="Отменить запланированное удаление?"
            variant="ghost"
          >
            Отменить удаление
          </AdminActionButton>
        </Banner>
      ) : null}

      <Section title="Статус">
        <Field label="Создан">{formatDateTime(account.createdAt)}</Field>
        <Field label="Подтверждён">
          {account.emailVerifiedAt
            ? formatDateTime(account.emailVerifiedAt)
            : 'не подтверждён'}
        </Field>
        <Field label="Состояние">
          {account.purgedAt
            ? 'удалён'
            : account.disabledAt
              ? `отключён ${formatDateTime(account.disabledAt)}`
              : 'активен'}
        </Field>
        {!account.purgedAt ? (
          <div style={{ marginTop: 12 }}>
            {account.disabledAt ? (
              <AdminActionButton
                endpoint={`/api/admin/accounts/${account.id}/disable`}
                body={{ disabled: false }}
                variant="ghost"
              >
                Включить
              </AdminActionButton>
            ) : (
              <AdminActionButton
                endpoint={`/api/admin/accounts/${account.id}/disable`}
                body={{ disabled: true }}
                confirmText="Отключить учётную запись?"
                variant="danger"
              >
                Отключить
              </AdminActionButton>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Роли">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ALL_ROLES.map((role) => {
            const has = roles.includes(role)
            return (
              <div
                key={role}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <span style={{ minWidth: 90, fontFamily: 'monospace' }}>
                  {role}
                </span>
                <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
                  {has ? 'выдана' : 'не выдана'}
                </span>
                {!account.purgedAt ? (
                  has ? (
                    <AdminActionButton
                      endpoint={`/api/admin/accounts/${account.id}/role`}
                      body={{ role, op: 'revoke' }}
                      variant="ghost"
                      confirmText={`Отозвать роль ${role}?`}
                    >
                      Отозвать
                    </AdminActionButton>
                  ) : (
                    <AdminActionButton
                      endpoint={`/api/admin/accounts/${account.id}/role`}
                      body={{ role, op: 'grant' }}
                      variant="primary"
                    >
                      Выдать
                    </AdminActionButton>
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      </Section>

      {!account.purgedAt && isTeacher ? (
        <Section title="Назначенные ученики">
          <TeacherLearnersAdmin
            teacherAccountId={account.id}
            currentLearners={teacherLearners}
            candidates={learnerCandidates}
          />
        </Section>
      ) : null}

      {!account.purgedAt && isLearnerView ? (
        <Section title="Учитель">
          {activeTeacherList.length > 1 ? (
            <div style={{ marginBottom: 12 }}>
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 13,
                  margin: '0 0 6px 0',
                }}
              >
                Активные привязки ({activeTeacherList.length}):
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {activeTeacherList.map((t) => (
                  <li
                    key={t.id}
                    style={{ fontSize: 13, color: 'var(--text)' }}
                  >
                    • {t.email}
                  </li>
                ))}
              </ul>
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12,
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                Выбор ниже — это операторская переустановка: указанный
                учитель станет единственным активным, остальные ссылки
                будут переведены в статус «отвязан».
              </p>
            </div>
          ) : null}
          <TeacherAssignment
            accountId={account.id}
            currentTeacherId={account.assignedTeacherId}
            teachers={teachers.filter((t) => t.id !== account.id)}
          />
        </Section>
      ) : null}

      {!account.purgedAt && isLearnerView ? (
        <Section title="Биллинг">
          <Field label="Активные пакеты">
            {packages.length === 0 ? (
              <span style={{ color: 'var(--secondary)' }}>—</span>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {packages.map((p) => (
                  <li key={p.id} style={{ fontSize: 13 }}>
                    {p.titleSnapshot}: осталось {p.countRemaining}/{p.countInitial} ·
                    до {new Date(p.expiresAt).toLocaleDateString('ru-RU')}
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="К оплате (postpaid debt)">
            {debt.length === 0 ? (
              <span style={{ color: 'var(--secondary)' }}>—</span>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {debt.map((d) => (
                  <li key={d.slotId} style={{ fontSize: 13 }}>
                    {new Date(d.startAt).toLocaleString('ru-RU')} ·{' '}
                    {d.durationMinutes} мин · {d.status}
                    {d.expectedAmountKopecks !== null
                      ? ` · ${Math.round(d.expectedAmountKopecks / 100)}₽`
                      : ' · без цены'}
                    {d.legacyGrandfathered ? ' · унаследованный' : ''}
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </Section>
      ) : null}

      <Section title="Профиль">
        {profile ? (
          <>
            <Field label="Имя">{profile.firstName ?? '—'}</Field>
            <Field label="Фамилия">{profile.lastName ?? '—'}</Field>
            <Field label="Отображаемое имя">{profile.displayName ?? '—'}</Field>
            <Field label="Часовой пояс">{profile.timezone ?? '—'}</Field>
            <Field label="Язык">{profile.locale ?? '—'}</Field>
            <Field label="Обновлён">{formatDateTime(profile.updatedAt)}</Field>
          </>
        ) : (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Профиль не заполнен.
          </p>
        )}
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 12,
        fontSize: 13,
        marginBottom: 6,
      }}
    >
      <span style={{ color: 'var(--secondary)' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'muted'
  children: React.ReactNode
}) {
  const colors = {
    warn: { background: 'rgba(255, 196, 0, 0.08)', border: 'rgba(255, 196, 0, 0.3)' },
    muted: { background: 'rgba(255, 255, 255, 0.04)', border: 'var(--border)' },
  }[tone]
  return (
    <div
      style={{
        padding: '12px 16px',
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        fontSize: 13,
        marginBottom: 16,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU')
}
