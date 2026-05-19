import {
  listOperatorSettingsForAdmin,
  SETTING_SCHEMA,
  type AdminSettingView,
  type SettingKey,
} from '@/lib/admin/operator-settings'
import {
  PROBE_NAMES,
  type ProbeName,
  type ProbeStatus,
  getProbeStatus,
} from '@/lib/admin/probe-status'

import { SettingEditor } from './setting-editor'
import { TestSendButton } from './test-send-button'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Уведомления оператора. Админка',
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
  // BCS-DEF-1 Phase 1 (2026-05-19) — registered for Record<ProbeName>
  // completeness, but the alerts page iterates `PROBE_NAMES` from
  // `lib/admin/probe-status.ts` which excludes 'conflict-unresolved'
  // until Phase 2 ships the probe script. The title doesn't surface
  // in the UI until that PR adds the probe name to PROBE_NAMES.
  'conflict-unresolved':
    'conflict-unresolved — нерешённые конфликты с Google-календарём',
}

export default async function AdminAlertsPage() {
  const [statuses, settings] = await Promise.all([
    Promise.all(PROBE_NAMES.map(getProbeStatus)),
    listOperatorSettingsForAdmin(),
  ])
  const probeMigrationPending = statuses.some(
    (s) => 'migrationPending' in s && s.migrationPending,
  )
  const settingsMigrationPending =
    'migrationPending' in settings && settings.migrationPending === true

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Уведомления оператора
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
        Четыре systemd-пробника шлют письма оператору при подозрительной
        активности (попытки входа, патологичные слоты, webhook-поток
        CloudPayments, нерешённые конфликты с Google-календарём). Здесь
        видно когда они последний раз бежали, какой был вердикт, какие
        пороги действуют сейчас, и можно отправить тестовое письмо
        чтобы проверить транспорт. Пороги редактируются прямо здесь:
        DB → env → default. Изменения подхватываются следующим тиком
        systemd-пробника.
      </p>

      {probeMigrationPending ? (
        <div
          style={{
            padding: '12px 16px',
            border: '1px solid #c97a00',
            background: '#fff7e6',
            borderRadius: 8,
            marginBottom: 12,
            color: '#1f1f1f',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Наблюдение недоступно.</strong> Таблица{' '}
          <code>probe_runs</code> (миграция <code>0053</code>) не
          найдена. Запустите <code>npm run migrate:up</code> на VPS —
          last-run / last-alert появятся со следующего тика.
        </div>
      ) : null}

      {settingsMigrationPending ? (
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
          <strong>Редактор порогов недоступен.</strong> Таблица{' '}
          <code>operator_settings</code> не найдена. Запустите{' '}
          <code>npm run migrate:up</code> (миграция 0055) на VPS, после
          этого редактор активируется.
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {statuses.map((status, idx) => (
          <ProbeCard
            key={PROBE_NAMES[idx]}
            probeName={PROBE_NAMES[idx]}
            title={PROBE_TITLES[PROBE_NAMES[idx]]}
            status={status}
            settings={settings}
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
  settings,
}: {
  probeName: ProbeName
  title: string
  status: ProbeStatus
  settings: AdminSettingView
}) {
  const migrationPending =
    'migrationPending' in status && status.migrationPending

  // Per-probe knobs from the global schema. Filtered by scope.
  const probeKeys = (Object.keys(SETTING_SCHEMA) as SettingKey[]).filter(
    (k) => SETTING_SCHEMA[k].scope === probeName,
  )

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

      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--secondary)',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 4,
          }}
        >
          Редактор порогов
        </div>
        {probeKeys.map((k) => {
          const meta = SETTING_SCHEMA[k]
          const settingsAvailable =
            !('migrationPending' in settings) || !settings.migrationPending
          const entry =
            settingsAvailable && 'keys' in settings ? settings.keys[k] : null
          if (!entry) {
            // Migration-pending state: editor row still rendered but
            // disabled so the operator sees the knob exists.
            return (
              <SettingEditor
                key={k}
                settingKey={k}
                meta={meta}
                value={meta.default}
                source="default"
                rawDb={null}
                rawEnv={null}
                updatedAt={null}
                disabled
              />
            )
          }
          return (
            <SettingEditor
              key={k}
              settingKey={k}
              meta={meta}
              value={entry.value}
              source={entry.source}
              rawDb={entry.rawDb}
              rawEnv={entry.rawEnv}
              updatedAt={entry.updatedAt}
            />
          )
        })}
      </div>
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
