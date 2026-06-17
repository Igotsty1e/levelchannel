// /cabinet/settings — 2026-06-17 Wave B Sub-PR 4.
//
// Hub для настроек ученика. Дотации к существующему /cabinet/profile +
// /cabinet/settings/calendar. На этой странице — тайлы:
//   - Профиль (link на /cabinet/profile)
//   - Интеграции (link на /cabinet/settings/calendar — пока тут учительский
//     pull/push status; future: добавим .ics export + TG binding)
//   - Уведомления (link на /cabinet/profile секцию TG/Push — пока)
//   - Безопасность (link на /cabinet/security если есть, иначе TBD)
//
// Owner-feedback 2026-06-17: «давай подумаем может уже пора сделать тоже
// нижнее таб меню — "Главная" "Занятия" "Настройки"». Этот раздел —
// 4-й tab nav'а LearnerCabinetNav (PR 2 #674).

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SettingsTile } from '@/components/teacher/settings/settings-tile'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getAuthPool } from '@/lib/auth/pool'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Настройки — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function LearnerSettingsHubPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id
  const pool = getAuthPool()
  const r = await pool.query<{ learner_telegram_enabled: boolean | null }>(
    `select learner_telegram_enabled from accounts where id = $1::uuid`,
    [accountId],
  )
  const tgBound = r.rows[0]?.learner_telegram_enabled === true

  return (
    <div className="settings-hub">
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          Настройки
        </h1>
        <p style={{ color: 'var(--secondary)', fontSize: 14, marginTop: 4 }}>
          Профиль, интеграции, уведомления, безопасность.
        </p>
      </header>
      <ul className="settings-hub-grid" role="list">
        <li>
          <SettingsTile
            href="/cabinet/profile"
            icon={<ProfileIcon />}
            title="Профиль"
          />
        </li>
        <li>
          <SettingsTile
            href="/cabinet/settings/calendar"
            icon={<IntegrationsGearIcon />}
            title="Календарь"
            status={
              tgBound
                ? { label: 'Подключено', tone: 'success' }
                : { label: 'Не настроено', tone: 'default' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/cabinet/profile"
            icon={<NotificationsBellIcon />}
            title="Уведомления"
            status={
              tgBound
                ? { label: 'Telegram', tone: 'success' }
                : { label: 'Только e-mail', tone: 'default' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/cabinet/payments"
            icon={<PaymentsCardIcon />}
            title="История оплат"
          />
        </li>
      </ul>

      <p style={{ fontSize: 12, color: 'var(--secondary)', marginTop: 24 }}>
        <Link href="/cabinet" style={{ color: 'inherit' }}>
          ← на главную
        </Link>
      </p>
    </div>
  )
}

function ProfileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20.5c0-3.9 3.4-6.75 7.5-6.75s7.5 2.85 7.5 6.75" />
    </svg>
  )
}

function IntegrationsGearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function NotificationsBellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function PaymentsCardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 11h18" />
      <path d="M7 16h4" />
    </svg>
  )
}
