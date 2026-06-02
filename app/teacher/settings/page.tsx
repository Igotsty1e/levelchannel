// Mobile-first cabinet restructure (2026-05-31) — Settings hub.
//
// Один из 4 основных разделов кабинета. Карточный grid; на mobile
// один столбец, на desktop сетка auto-fit minmax(240px, 1fr).
//
// 6 sub-разделов:
//   - Профиль                — личные данные, часовой пояс, опасные действия
//   - Цены занятий           — был «Тарифы» (/teacher/tariffs)
//   - Пакеты уроков          — был «Пакеты» (/teacher/packages)
//   - Подписка на платформу  — Стартовый/Базовый/Расширенный (/teacher/subscription)
//   - Календарь и интеграции — /teacher/settings/calendar
//   - Уведомления            — /teacher/settings/digest (сводка занятий)
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Настройки кабинета — LevelChannel',
  robots: { index: false, follow: false },
}

type HubItem = {
  href: string
  title: string
  description: string
}

const HUB_ITEMS: ReadonlyArray<HubItem> = [
  {
    href: '/teacher/profile',
    title: 'Профиль',
    description: 'Имя, e-mail, часовой пояс, опасные действия.',
  },
  {
    href: '/teacher/tariffs',
    title: 'Цены занятий',
    description: 'Стоимость отдельных уроков для ваших учеников.',
  },
  {
    href: '/teacher/packages',
    title: 'Пакеты уроков',
    description: 'Готовые пакеты по 4 / 8 / N уроков для ученика.',
  },
  {
    href: '/teacher/subscription',
    title: 'Подписка на платформу',
    description: 'Тариф LevelChannel — Стартовый / Базовый / Расширенный.',
  },
  {
    href: '/teacher/settings/calendar',
    title: 'Календарь и интеграции',
    description: 'Google Calendar, расписание, отображение.',
  },
  {
    href: '/teacher/settings/digest',
    title: 'Уведомления',
    description: 'Утренняя сводка занятий, напоминания, Telegram.',
  },
]

export default function TeacherSettingsHubPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
        Настройки
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        Профиль, цены и пакеты ваших занятий, подписка на платформу,
        календарь, уведомления.
      </p>

      <div className="settings-hub-grid">
        {HUB_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="settings-hub-card">
            <span className="settings-hub-card-title">{item.title}</span>
            <span className="settings-hub-card-desc">{item.description}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
