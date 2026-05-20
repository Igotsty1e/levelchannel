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
  type TelegramRunStatus,
  getLatestTelegramRun,
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
// Plan: docs/plans/alerts-obs.md (initial 3 probes); extended by
// BCS-DEF-1 (2026-05-19) to 4 probes — see PROBE_NAMES in
// lib/admin/probe-status.ts.
//
// Shows for each of the systemd alert probes:
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
  // BCS-DEF-1 (2026-05-19) — registered for Record<ProbeName>
  // completeness. The probe script + PROBE_NAMES entry shipped in
  // subsequent sub-PRs, so this title now surfaces in the UI alongside
  // the other three probes.
  'conflict-unresolved':
    'conflict-unresolved — нерешённые конфликты с Google-календарём',
}

// BCS-DEF-1-TG (2026-05-19) — Telegram channel-wide knobs render in a
// dedicated section above the per-probe cards (plan §2.7).
const TELEGRAM_CHANNEL_KEYS: ReadonlyArray<SettingKey> = [
  'TELEGRAM_ALERTS_MASTER_SWITCH',
  'TELEGRAM_ALERTS_RETRY_MAX',
]

// BCS-DEF-4 (2026-05-19) — learner-reminders scheduler knobs.
// Co-located with the alert probes (plan §1.4 REVISED: operator
// already visits this page daily; standalone settings page deferred).
// The scheduler is NOT in `PROBE_NAMES` iteration, so this card is
// rendered separately above the alert-probe cards but after the
// Telegram channel card.
const LEARNER_REMINDER_KEYS: ReadonlyArray<SettingKey> = [
  'LEARNER_REMINDERS_EMAIL_ENABLED',
  'LEARNER_REMINDER_WINDOW_MINUTES',
  'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
  // BCS-DEF-4-TG (2026-05-20) — master switch for learner Telegram channel.
  'LEARNER_REMINDERS_TELEGRAM_ENABLED',
]

export default async function AdminAlertsPage() {
  const [statuses, settings, telegramRun] = await Promise.all([
    Promise.all(PROBE_NAMES.map(getProbeStatus)),
    listOperatorSettingsForAdmin(),
    getLatestTelegramRun(),
  ])
  const probeMigrationPending = statuses.some(
    (s) => 'migrationPending' in s && s.migrationPending,
  )
  const settingsMigrationPending =
    'migrationPending' in settings && settings.migrationPending === true
  // BCS-DEF-1-TG (2026-05-19) — env-presence indicators (server-only
  // booleans; the actual values NEVER cross to the page).
  const telegramTokenPresent = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim() !== '',
  )
  const telegramChatPresent = Boolean(
    process.env.TELEGRAM_ALERT_CHAT_ID
      && process.env.TELEGRAM_ALERT_CHAT_ID.trim() !== '',
  )

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
        Четыре systemd-пробника настроены на отправку писем оператору
        при подозрительной активности (попытки входа, патологичные слоты,
        webhook-поток CloudPayments, нерешённые конфликты с
        Google-календарём). Плюс отдельная служба напоминаний для
        учащихся — она шлёт каждому одно письмо за окно (по умолчанию
        60&nbsp;минут) до начала занятия. Чтобы реальные тики и письма
        пошли, нужно запустить <code>scripts/activate-prod-ops.sh</code>{' '}
        на VPS — пробники, чьи systemd-таймеры ещё не установлены,
        покажут «Данные недоступны» ниже. Тестовое письмо можно
        отправить прямо отсюда (это уже работает до активации таймера).
        Пороги редактируются прямо здесь: DB → env → default. Изменения
        подхватываются следующим тиком systemd-пробника.
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
        <LearnerRemindersCard settings={settings} />
        <TelegramChannelCard
          settings={settings}
          telegramRun={telegramRun}
          tokenPresent={telegramTokenPresent}
          chatPresent={telegramChatPresent}
        />
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

// BCS-DEF-4 (2026-05-19) — learner-reminders scheduler card. Plan §2.6.
// Co-located with the alert probes (operator already visits this page
// daily; a standalone /admin/settings/reminders page is deferred until
// channel growth makes the embedded section bloated).
//
// The scheduler is NOT a `PROBE_NAMES` entry (no dedup-fingerprint, no
// last-alert surface) — so this card has no "last alert" field. We
// expose the 3 SETTING_SCHEMA knobs only, with a short explainer about
// what each one does.
function LearnerRemindersCard({ settings }: { settings: AdminSettingView }) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 20px',
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Напоминания учащимся
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.6,
          marginBottom: 12,
          maxWidth: 720,
        }}
      >
        Один раз в минуту служба{' '}
        <code>levelchannel-learner-reminder-dispatch.timer</code> читает
        будущие забронированные занятия и отправляет учащимся одно письмо
        за <strong>окно напоминания</strong> до начала. По умолчанию — за
        60&nbsp;минут. Идемпотентность гарантирует таблица{' '}
        <code>learner_reminder_dispatches</code>: одна строка на пару
        (занятие, канал). Изменения порогов подхватываются на следующем
        тике.
      </p>

      <div style={{ marginTop: 8 }}>
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
        {LEARNER_REMINDER_KEYS.map((k) => {
          const meta = SETTING_SCHEMA[k]
          const settingsAvailable =
            !('migrationPending' in settings) || !settings.migrationPending
          const entry =
            settingsAvailable && 'keys' in settings ? settings.keys[k] : null
          if (!entry) {
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

// BCS-DEF-1-TG (2026-05-19) — channel-wide Telegram card (plan §2.7).
// Shows master switch + retry knob, env-presence indicators, and the
// latest Telegram delivery across all probes.
function TelegramChannelCard({
  settings,
  telegramRun,
  tokenPresent,
  chatPresent,
}: {
  settings: AdminSettingView
  telegramRun: TelegramRunStatus
  tokenPresent: boolean
  chatPresent: boolean
}) {
  const migrationPending =
    'migrationPending' in telegramRun && telegramRun.migrationPending
  const lastRun =
    !('migrationPending' in telegramRun && telegramRun.migrationPending)
      ? telegramRun.lastRun
      : null
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 20px',
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Telegram-канал
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.6,
          marginBottom: 12,
          maxWidth: 720,
        }}
      >
        Параллельный канал доставки для всех четырёх пробников. Включается
        мастер-переключателем после настройки BotFather и записи{' '}
        <code>TELEGRAM_BOT_TOKEN</code> + <code>TELEGRAM_ALERT_CHAT_ID</code>{' '}
        в прод-окружение. Тело сообщения — короткая сводка со ссылкой на
        эту страницу; PII в Telegram не уходит.
      </p>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label="Переменные окружения">
          <span style={{ fontSize: 12 }}>
            <code>TELEGRAM_BOT_TOKEN</code>:{' '}
            <strong>{tokenPresent ? 'задан' : 'не задан'}</strong>
            {'   '}
            <code>TELEGRAM_ALERT_CHAT_ID</code>:{' '}
            <strong>{chatPresent ? 'задан' : 'не задан'}</strong>
          </span>
        </Field>

        <Field label="Последняя отправка">
          {migrationPending ? (
            <span style={{ color: 'var(--secondary)' }}>
              нет данных — миграция 0061 ещё не применена
            </span>
          ) : lastRun ? (
            <>
              <span>{formatDateTime(lastRun.ranAt)}</span>
              {' — '}
              <code style={{ fontSize: 12 }}>{lastRun.probeName}</code>
              {' / '}
              <code style={{ fontSize: 12 }}>{lastRun.verdictKind}</code>
              {lastRun.messageId ? (
                <code style={{ fontSize: 11, marginLeft: 8 }}>
                  tg: {lastRun.messageId}
                </code>
              ) : null}
              {lastRun.errorMessage ? (
                <span style={{ color: '#b00020', fontSize: 12 }}>
                  {' '}— {lastRun.errorMessage}
                </span>
              ) : null}
            </>
          ) : (
            <span style={{ color: 'var(--secondary)' }}>
              нет данных — Telegram-канал ещё не запускался
            </span>
          )}
        </Field>
      </div>

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
          Настройки канала
        </div>
        {TELEGRAM_CHANNEL_KEYS.map((k) => {
          const meta = SETTING_SCHEMA[k]
          const settingsAvailable =
            !('migrationPending' in settings) || !settings.migrationPending
          const entry =
            settingsAvailable && 'keys' in settings ? settings.keys[k] : null
          if (!entry) {
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

      <Field label="Последнее уведомление">
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
            нет данных — уведомление ещё не отправлялось
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
