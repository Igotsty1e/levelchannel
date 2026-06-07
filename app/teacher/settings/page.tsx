// /teacher/settings — DEEP UX redesign, 2026-06-07 (round 2).
//
// Settings hub. One of the 4 cabinet sections (cabinet-nav.tsx); the
// «Настройки» tab already labels the page, so there is no H1 here
// (design-system.md §10.3 — don't duplicate the active nav label).
//
// Round-2 round of owner feedback:
//   - leading icons rebuilt as semantic inline SVGs (person, ticket,
//     card, gear) so each tile visually previews the section it opens,
//   - description copy removed from tiles (it duplicated the in-page
//     explainer of each settings sub-page),
//   - «Google Calendar» tile renamed to «Интеграции» — generic name
//     that holds up as we add more integrations (Telegram, Webhook).
//
// Tiles show live status pulled SSR-side:
//   - Профиль        → setup-checklist.profileFilled
//   - Цены занятий   → countActiveTariffsForTeacher
//   - Пакеты уроков  → countActivePackagesByTeacher
//   - Подписка       → без status-pill (длинный title ломал высоту
//                      карточки относительно остальных, 2026-06-07)
//   - Интеграции     → isCalendarConnected (для единственной интеграции)
//   - Уведомления    → accounts.teacher_telegram_enabled
//
// Anti-spoof: account id resolved from the session cookie, never from
// the query string or body. The outer /teacher/layout.tsx already
// enforces the teacher-verified gate; this page falls back with a
// defensive /login redirect for cookie-expiry races.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SettingsTile } from '@/components/teacher/settings/settings-tile'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { countActivePackagesByTeacher } from '@/lib/billing/packages'
import { isCalendarConnected } from '@/lib/calendar/derive-status'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'
import { computeTeacherSetupChecklist } from '@/lib/onboarding/teacher-setup-checklist'
import { countActivePaymentMethods } from '@/lib/payments/sbp-methods'
import { countActiveTariffsForTeacher } from '@/lib/pricing/tariffs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Настройки кабинета — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherSettingsHubPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const accountId = session.account.id

  const telegramRowQuery = getAuthPool().query<{
    teacher_telegram_enabled: boolean | null
  }>(
    `select teacher_telegram_enabled
       from accounts where id = $1::uuid`,
    [accountId],
  )

  const [
    checklist,
    tariffCount,
    packageCount,
    integration,
    telegramRow,
    paymentMethodsCount,
  ] = await Promise.all([
    computeTeacherSetupChecklist(accountId),
    countActiveTariffsForTeacher(accountId),
    countActivePackagesByTeacher(accountId),
    getGoogleIntegrationMeta(accountId),
    telegramRowQuery,
    countActivePaymentMethods(accountId),
  ])

  const calendarConnected = isCalendarConnected(integration)
  const teacherTgBound =
    telegramRow.rows[0]?.teacher_telegram_enabled === true

  return (
    <div className="settings-hub">
      <ul className="settings-hub-grid" role="list">
        <li>
          <SettingsTile
            href="/teacher/profile"
            icon={<ProfileIcon />}
            title="Профиль"
            status={
              checklist.profileFilled
                ? { label: 'Заполнен', tone: 'success' }
                : { label: 'Требует данных', tone: 'warning' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/teacher/tariffs"
            icon="₽"
            title="Цены занятий"
            status={
              tariffCount > 0
                ? { label: `${tariffCount} активных`, tone: 'default' }
                : { label: 'Нет', tone: 'warning' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/teacher/packages"
            icon={<PackageTicketsIcon />}
            title="Пакеты занятий"
            status={
              packageCount > 0
                ? { label: `${packageCount} активных`, tone: 'default' }
                : { label: 'Нет', tone: 'warning' }
            }
          />
        </li>
        <li>
          {/* Без status-pill: длинный title «Подписка на платформу»
              + бейдж тарифа ломали единообразие высоты карточки
              относительно остальных тайлов настроек (2026-06-07). */}
          <SettingsTile
            href="/teacher/subscription"
            icon={<SubscriptionCardIcon />}
            title="Подписка на платформу"
          />
        </li>
        <li>
          <SettingsTile
            href="/teacher/settings/payment-methods"
            icon={<SbpAcceptIcon />}
            title="Приём оплат"
            status={
              paymentMethodsCount > 0
                ? { label: `${paymentMethodsCount} активных`, tone: 'success' }
                : { label: 'Не настроено', tone: 'warning' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/teacher/settings/calendar"
            icon={<IntegrationsGearIcon />}
            title="Интеграции"
            status={
              calendarConnected
                ? { label: 'Подключён', tone: 'success' }
                : { label: 'Не подключён', tone: 'default' }
            }
          />
        </li>
        <li>
          <SettingsTile
            href="/teacher/settings/digest"
            icon="✉"
            title="Уведомления"
            status={
              teacherTgBound
                ? { label: 'Telegram', tone: 'success' }
                : { label: 'Только e-mail', tone: 'default' }
            }
          />
        </li>
      </ul>
    </div>
  )
}

// Inline SVGs — sized via `.settings-tile-icon > svg` in globals.css
// (26×26). Stroke-only, currentColor so :hover pulls accent through.

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

function PackageTicketsIcon() {
  // Билет с отрывным корешком — узнаваемый «талон / абонемент».
  // Идея «несколько билетов» передаётся через title раздела
  // («Пакеты занятий»), а сам глиф остаётся чистым на 20×20.
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
      <path d="M5 7h14a1.5 1.5 0 0 1 1.5 1.5v1.75a1.75 1.75 0 0 0 0 3.5V15.5A1.5 1.5 0 0 1 19 17H5a1.5 1.5 0 0 1-1.5-1.5v-1.75a1.75 1.75 0 0 0 0-3.5V8.5A1.5 1.5 0 0 1 5 7z" />
      <path d="M10 7v10" strokeDasharray="1.4 1.7" />
    </svg>
  )
}

function SubscriptionCardIcon() {
  // Платёжная карта — единственный визуальный сигнал «оплата сервиса».
  // Магнитная полоса (тонкая, opacity .6) даёт ассоциацию с банкингом;
  // без звёздного маркера — на 20×20 он создавал визуальный шум.
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
      <rect x="3" y="6" width="18" height="12" rx="2.25" />
      <path d="M3 10h18" />
      <path d="M6 15h4" />
    </svg>
  )
}

function SbpAcceptIcon() {
  // СБП: визуально-узнаваемое объятие — телефон с rouble-знаком внутри.
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
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M9 5.5h6" />
      <path d="M11 18.5h2" />
      <path d="M10.25 9.5h2.5a2 2 0 1 1 0 4h-2.5v3" />
      <path d="M9 13.5h4" />
    </svg>
  )
}

function IntegrationsGearIcon() {
  // Упрощённая шестерёнка — 6 зубцов через short-stroke spokes
  // (на 20×20 fitted, без лишних path-сегментов).
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
      <path d="M12 2.5v3" />
      <path d="M12 18.5v3" />
      <path d="M2.5 12h3" />
      <path d="M18.5 12h3" />
      <path d="M5.2 5.2l2.1 2.1" />
      <path d="M16.7 16.7l2.1 2.1" />
      <path d="M18.8 5.2l-2.1 2.1" />
      <path d="M7.3 16.7l-2.1 2.1" />
    </svg>
  )
}
