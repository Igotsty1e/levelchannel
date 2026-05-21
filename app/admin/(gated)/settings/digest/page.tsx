import {
  getDigestLastRun,
  getDigestSevenDaySummary,
  type DigestDayStat,
} from '@/lib/admin/digest-summary'
import {
  listOperatorSettingsForAdmin,
  SETTING_SCHEMA,
  type SettingKey,
} from '@/lib/admin/operator-settings'
import { getTeacherTelegramSummary } from '@/lib/admin/teacher-telegram-summary'

import { SettingEditor } from '../alerts/setting-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Утренний дайджест. Админка',
}

// BCS-DEF-5 (2026-05-19) — admin surface for the daily 08:00 teacher
// lesson digest. Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.7.
//
// Three sections:
//   1. Master switch + rate-limit + max-attempts editor (3 keys).
//   2. Last-tick summary widget (most-recent probe_runs row).
//   3. 7-day summary table (sent / empty_day / errors).
//
// Migration-pending banners are shown if the underlying tables are
// missing — same pattern as /admin/settings/alerts.

const DIGEST_KEYS: ReadonlyArray<SettingKey> = [
  'TEACHER_DIGEST_MASTER_SWITCH',
  'TEACHER_DIGEST_RATE_LIMIT_PER_TICK',
  'TEACHER_DIGEST_MAX_ATTEMPTS',
  'TEACHER_DIGEST_TELEGRAM_ENABLED',
]

export default async function AdminDigestPage() {
  const [settings, lastRun, sevenDay, telegramSummary] = await Promise.all([
    listOperatorSettingsForAdmin(),
    getDigestLastRun(),
    getDigestSevenDaySummary(),
    getTeacherTelegramSummary(),
  ])

  const settingsMigrationPending =
    'migrationPending' in settings && settings.migrationPending === true
  const lastRunMigrationPending =
    'migrationPending' in lastRun && lastRun.migrationPending === true
  const sevenDayMigrationPending =
    'migrationPending' in sevenDay && sevenDay.migrationPending === true

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Утренний дайджест
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
        Ежедневный дайджест занятий на день для учителей; отправляется
        в 08:00 по локальному времени учителя. Чтобы рассылка пошла,
        включите мастер-переключатель ниже. Если переключатель
        выключен, systemd-таймер продолжает тикать, но писем не
        отправляет — в журнале остаётся отметка{' '}
        <code>digest_skipped_disabled</code>.
      </p>

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
          <strong>Редактор недоступен.</strong> Таблица{' '}
          <code>operator_settings</code> не найдена. Запустите{' '}
          <code>npm run migrate:up</code> (миграция 0055) на VPS, после
          этого редактор активируется.
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            background: 'var(--surface)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Настройки рассылки
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
            Включите рассылку только после проверки одного-двух
            тестовых тиков (см. журнал ниже). Лимит на тик ограничивает
            количество писем за одну минуту — для типичной нагрузки
            подходит значение по умолчанию.
          </p>
          {DIGEST_KEYS.map((k) => {
            const meta = SETTING_SCHEMA[k]
            const settingsAvailable =
              !('migrationPending' in settings)
              || !settings.migrationPending
            const entry =
              settingsAvailable && 'keys' in settings
                ? settings.keys[k]
                : null
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
        </section>

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            background: 'var(--surface)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Последний тик
          </h2>
          {lastRunMigrationPending ? (
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              Данные недоступны до применения миграции{' '}
              <code>0063</code>.
            </p>
          ) : 'lastRun' in lastRun && lastRun.lastRun ? (
            <LastRunBody run={lastRun.lastRun} />
          ) : (
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              Нет данных — дайджест ещё не запускался.
            </p>
          )}
        </section>

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            background: 'var(--surface)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Сводка за 7 дней
          </h2>
          {sevenDayMigrationPending ? (
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              Данные недоступны до применения миграции{' '}
              <code>0062</code>.
            </p>
          ) : 'days' in sevenDay && sevenDay.days.length > 0 ? (
            <SevenDayTable days={sevenDay.days} />
          ) : (
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              Нет данных за последние 7 дней.
            </p>
          )}
        </section>

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            background: 'var(--surface)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Telegram-канал
          </h2>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 12,
              lineHeight: 1.6,
              margin: '0 0 12px 0',
              maxWidth: 720,
            }}
          >
            Канал по&nbsp;умолчанию выключен. Перед включением убедитесь, что
            хотя&nbsp;бы один учитель привязал Telegram через{' '}
            <code>/teacher/settings/digest</code>. Telegram-канал использует тот
            же бот, что и&nbsp;напоминания учащимся (BCS-DEF-4-TG).
          </p>
          <TeacherTelegramSummaryBody summary={telegramSummary} />
        </section>
      </div>
    </>
  )
}

function TeacherTelegramSummaryBody({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getTeacherTelegramSummary>>
}) {
  if (summary.kind === 'migration_pending') {
    return (
      <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
        Данные недоступны до&nbsp;применения миграции <code>0071</code>.
      </p>
    )
  }
  return (
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
      <li style={{ fontSize: 13 }}>
        Активных привязок учителей:{' '}
        <strong data-testid="teacher-tg-active-bindings">
          {summary.activeBindings}
        </strong>
      </li>
      <li style={{ fontSize: 13 }}>
        <code>TELEGRAM_BOT_TOKEN</code>:{' '}
        <strong>{summary.botTokenPresent ? 'задан' : 'не задан'}</strong>
      </li>
    </ul>
  )
}

function LastRunBody({
  run,
}: {
  run: {
    ranAt: string
    verdictKind: string
    stats: Record<string, unknown> | null
    errorMessage: string | null
  }
}) {
  const stats = (run.stats ?? null) as Record<string, unknown> | null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Время">
        <span>{formatDateTime(run.ranAt)}</span>
        {' — '}
        <code style={{ fontSize: 12 }}>{run.verdictKind}</code>
        {run.errorMessage ? (
          <span style={{ color: '#b00020', fontSize: 12 }}>
            {' '}— {run.errorMessage}
          </span>
        ) : null}
      </Field>
      {stats ? (
        <Field label="Статистика">
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
            {Object.entries(stats).map(([key, value]) => (
              <li
                key={key}
                style={{ fontSize: 12, fontFamily: 'monospace' }}
              >
                {key} ={' '}
                {typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
    </div>
  )
}

function SevenDayTable({ days }: { days: DigestDayStat[] }) {
  return (
    <table
      style={{
        borderCollapse: 'collapse',
        width: '100%',
        maxWidth: 480,
        fontSize: 13,
      }}
    >
      <thead>
        <tr>
          <Th>Дата</Th>
          <Th align="right">Отправлено</Th>
          <Th align="right">Пустой день</Th>
          <Th align="right">Ошибки</Th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.date}>
            <Td>{d.date}</Td>
            <Td align="right">{d.sent}</Td>
            <Td align="right">{d.emptyDay}</Td>
            <Td align="right">{d.errors}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        borderBottom: '1px solid var(--border)',
        padding: '6px 8px',
        fontWeight: 500,
        color: 'var(--secondary)',
        fontSize: 12,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        borderBottom: '1px solid var(--border)',
        padding: '6px 8px',
        fontFamily: align === 'right' ? 'monospace' : undefined,
      }}
    >
      {children}
    </td>
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
