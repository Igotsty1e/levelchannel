import { PasswordChangeCard } from './password-card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Безопасность',
  robots: { index: false, follow: false },
}

export default function TeacherSecurityPage() {
  return (
    <div style={{ maxWidth: 720, marginInline: 'auto' }}>
      <div style={{ marginBottom: 16 }}>
        <a
          href="/teacher/settings"
          style={{ color: 'var(--secondary)', textDecoration: 'none', fontSize: 14 }}
        >
          ← Назад в настройки
        </a>
      </div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>Безопасность</h1>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          Смена пароля. После сохранения вас разлогинят на других устройствах.
        </p>
      </header>
      <PasswordChangeCard />
    </div>
  )
}
