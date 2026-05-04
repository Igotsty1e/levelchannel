import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminActionButton } from '@/app/admin/admin-action-button'
import {
  type AccountRole,
  getAccountById,
  listAccountRoles,
} from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALL_ROLES: AccountRole[] = ['admin', 'teacher', 'student']

type RouteParams = { params: Promise<{ id: string }> }

export default async function AdminAccountDetailPage({ params }: RouteParams) {
  const { id } = await params
  const account = await getAccountById(id)
  if (!account) notFound()

  const [roles, profile] = await Promise.all([
    listAccountRoles(account.id),
    getAccountProfile(account.id),
  ])

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
          Аккаунт удалён {formatDateTime(account.purgedAt)}. Данные обезличены,
          платёжная история сохранена под 54-ФЗ.
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
                confirmText="Отключить аккаунт?"
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

      <Section title="Профиль">
        {profile ? (
          <>
            <Field label="Имя">{profile.displayName ?? '—'}</Field>
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
