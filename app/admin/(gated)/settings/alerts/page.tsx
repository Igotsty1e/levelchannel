import {
  PROBE_NAMES,
  type ProbeName,
  type ProbeStatus,
  getProbeStatus,
} from '@/lib/admin/probe-status'

import { TestSendButton } from './test-send-button'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Алерты. Админка',
}

// ALERTS-OBS (2026-05-16) — read-only /admin/settings/alerts page.
// Plan: docs/plans/alerts-obs.md.
//
// Shows for each of the three systemd alert probes:
//   • last run timestamp + verdict
//   • last alert timestamp + recipient + fingerprint
//   • effective thresholds (snapshot from probe_runs.stats.thresholds —
//     NOT from process.env, which is stale)
//   • dry-run test-send button (POST /api/admin/settings/alerts/[probe]/test-send)
//
// Migration-pending banner takes precedence: if `probe_runs` doesn't
// exist (deploy ordering window before `npm run migrate:up` ran on
// prod), getProbeStatus returns { migrationPending: true } and the
// page shows a banner instead of crashing with 500.

const PROBE_TITLES: Record<ProbeName, string> = {
  'auth-flow': 'auth-flow — попытки входа',
  'calendar-pathology': 'calendar-pathology — патологичные слоты',
  'webhook-flow': 'webhook-flow — webhook-поток CloudPayments',
}

export default async function AdminAlertsPage() {
  const statuses = await Promise.all(PROBE_NAMES.map(getProbeStatus))
  const migrationPending = statuses.some((s) => 'migrationPending' in s && s.migrationPending)

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Алерты — наблюдение
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
        Три systemd-пробника шлют письма оператору при подозрительной
        активности. Здесь видно когда они последний раз бежали, какой
        был вердикт, какие пороги действуют сейчас, и можно отправить
        тестовое письмо чтобы проверить транспорт. Редактирование
        порогов — отдельная волна (ALERTS-EDITOR), пока только env.
      </p>

      {migrationPending ? (
        <div
          style={{
            padding: '12px 16px',
            border: '1px solid #c97a00',
            background: '#fff7e6',
            borderRadius: 8,
            marginBottom: 24,
            color: '#1f1f1f',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>БД миграция не применена.</strong> Таблица{' '}
          <code>probe_runs</code> не найдена в базе. Запустите
          <code> npm run migrate:up </code>на VPS — после этого данные
          появятся со следующего тика systemd-пробников.
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {statuses.map((status, idx) => (
          <ProbeCard
            key={PROBE_NAMES[idx]}
            probeName={PROBE_NAMES[idx]}
            title={PROBE_TITLES[PROBE_NAMES[idx]]}
            status={status}
          />
        ))}
      </div>
    </>
  )
}

function ProbeCard({
  probeName,
  title,
  status,
}: {
  probeName: ProbeName
  title: string
  status: ProbeStatus
}) {
  const migrationPending = 'migrationPending' in status && status.migrationPending

  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 20px',
        background: 'var(--surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
        <TestSendButton probeName={probeName} disabled={migrationPending} />
      </div>

      {migrationPending ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
          Данные недоступны до применения миграции <code>0053</code>.
        </p>
      ) : (
        <ProbeBody status={status as Exclude<ProbeStatus, { migrationPending: true }>} />
      )}
    </section>
  )
}

function ProbeBody({
  status,
}: {
  status: Exclude<ProbeStatus, { migrationPending: true }>
}) {
  const { lastRun, lastAlert } = status
  const thresholds = (lastRun?.stats?.thresholds ?? null) as
    | Record<string, unknown>
    | null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Последний прогон">
        {lastRun ? (
          <>
            <span>{formatDateTime(lastRun.ranAt)}</span>
            {' — '}
            <code style={{ fontSize: 12 }}>{lastRun.verdictKind}</code>
            {lastRun.errorMessage ? (
              <span style={{ color: '#b00020', fontSize: 12 }}>
                {' '}— {lastRun.errorMessage}
              </span>
            ) : null}
          </>
        ) : (
          <span style={{ color: 'var(--secondary)' }}>
            нет данных — пробник ещё не запускался
          </span>
        )}
      </Field>

      <Field label="Последний алерт">
        {lastAlert ? (
          <>
            <span>{formatDateTime(lastAlert.ranAt)}</span>
            {' → '}
            <span>{lastAlert.recipientEmail ?? '(нет адреса)'}</span>
            {lastAlert.fingerprint ? (
              <code style={{ fontSize: 11, marginLeft: 8 }}>
                fp: {lastAlert.fingerprint.slice(0, 12)}
              </code>
            ) : null}
            {lastAlert.alertEmailId ? (
              <code style={{ fontSize: 11, marginLeft: 8 }}>
                resend: {lastAlert.alertEmailId.slice(0, 12)}
              </code>
            ) : null}
          </>
        ) : (
          <span style={{ color: 'var(--secondary)' }}>
            нет данных — алерт ещё не отправлялся
          </span>
        )}
      </Field>

      <Field label="Эффективные пороги">
        {thresholds ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {Object.entries(thresholds).map(([key, value]) => (
              <li key={key} style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {key} = {String(value)}
              </li>
            ))}
          </ul>
        ) : (
          <span style={{ color: 'var(--secondary)' }}>
            нет данных — пороги станут видны после первого тика
          </span>
        )}
      </Field>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          minWidth: 160,
          paddingTop: 2,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }) + ' UTC'
}
