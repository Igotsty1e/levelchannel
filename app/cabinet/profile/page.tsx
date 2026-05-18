import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { AuthInfoBox } from '@/components/auth-form-bits'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

import { DangerZone } from '../danger-zone'
import { LogoutButton } from '../logout-button'
import { ProfileEditor } from '../profile-editor'
import { ResendVerifyButton } from '../resend-verify-button'

// Dedicated profile / danger-zone surface (SAAS-5).
//
// Lives at /cabinet/profile to keep /cabinet uncluttered (lessons dominate
// the main surface). Auth gate mirrors /cabinet exactly so behaviour is
// consistent — invalid session → /login, admin → /admin. Profile management
// is available to both learners and teachers (no role gating beyond the
// admin-redirect).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Профиль — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function CabinetProfilePage() {
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

  const roles = await listAccountRoles(account.id)
  if (roles.includes('admin')) {
    redirect('/admin')
  }

  const profile = await getAccountProfile(account.id)

  return (
    <AuthShell>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ← Назад в кабинет
        </Link>
        <LogoutButton />
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
        Профиль
      </h1>

      {!isVerified ? (
        <AuthInfoBox>
          E-mail ещё не подтверждён. Откройте письмо, которое мы отправили при
          регистрации, и нажмите ссылку в нём. Если письма нет —{' '}
          <ResendVerifyButton />.
        </AuthInfoBox>
      ) : null}

      <ProfileEditor initialProfile={profile} fallbackEmail={account.email} />

      <DangerZone />
    </AuthShell>
  )
}
