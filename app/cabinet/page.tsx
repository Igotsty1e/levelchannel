import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { AuthInfoBox } from '@/components/auth-form-bits'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

import { LogoutButton } from './logout-button'
import { ResendVerifyButton } from './resend-verify-button'

// Server-side cabinet gate. Reads the session cookie directly (no HTTP
// round-trip to /api/auth/me) and SSR-redirects to /login when unauth'd.
// This avoids a flash of unauthenticated content.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Кабинет — LevelChannel',
}

export default async function CabinetPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null

  if (!cookieValue) {
    redirect('/login')
  }

  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }

  const { account } = current
  const isVerified = account.emailVerifiedAt !== null

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Личный кабинет</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 24 }}>
        Здравствуйте, <span style={{ color: 'var(--text)' }}>{account.email}</span>.
      </p>

      {!isVerified ? (
        <AuthInfoBox>
          E-mail ещё не подтверждён. Откройте письмо, которое мы отправили при регистрации, и нажмите ссылку в нём. Если письма нет —{' '}
          <ResendVerifyButton />.
        </AuthInfoBox>
      ) : null}

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Кабинет в разработке</h2>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
          Здесь скоро появится:
        </p>
        <ul style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.8, paddingLeft: 20, marginTop: 8 }}>
          <li>расписание ваших занятий</li>
          <li>оплата уроков и история платежей</li>
          <li>история занятий и материалы</li>
        </ul>
      </div>

      <LogoutButton />
    </AuthShell>
  )
}
