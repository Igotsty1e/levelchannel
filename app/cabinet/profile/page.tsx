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

  // BCS-DEF-4 (2026-05-19) — learner Telegram opt-in is a learner-only
  // feature; teachers' notifications surface ships separately in
  // BCS-DEF-5 (sibling plan, parallel scheduler). Per the BCS-DEF-4
  // plan §1.7 REVISED, this wave renders a READ-ONLY placeholder.
  // Active toggle + 8-char-code handshake ships in BCS-DEF-4-TG.
  const isTeacher = roles.includes('teacher')

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

      {!isTeacher ? <LearnerTelegramPlaceholder /> : null}

      <DangerZone />
    </AuthShell>
  )
}

// BCS-DEF-4 (2026-05-19) — read-only placeholder section for the
// learner Telegram opt-in. Plan §1.7 REVISED (post-Codex round-3
// BLOCKER #3): the active toggle, deep-link, and 8-char-code
// handshake live in BCS-DEF-4-TG; this wave only reserves the slot
// so the BCS-DEF-4-TG follow-up has a known placement target.
//
// Learner-only: teachers see their own notifications surface in
// BCS-DEF-5; the parent `CabinetProfilePage` gates by role.
function LearnerTelegramPlaceholder() {
  return (
    <section
      data-testid="learner-telegram-placeholder"
      style={{
        marginTop: 24,
        padding: '16px 20px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        Напоминания в&nbsp;Telegram
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Напоминания о&nbsp;начале занятия будут приходить в&nbsp;Telegram,
        когда мы запустим бота. Пока что мы присылаем напоминания только
        на&nbsp;e-mail.
      </p>
    </section>
  )
}
