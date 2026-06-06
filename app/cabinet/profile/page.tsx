import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthInfoBox } from '@/components/auth-form-bits'
import { SiteHeader } from '@/components/site-header'
import { LearnerPushSubscription } from '@/components/cabinet/learner-push-subscription'
import { LearnerTelegramBinding } from '@/components/cabinet/learner-telegram-binding'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { resolveLearnerPushState } from '@/lib/notifications/learner-push-state'

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
  // BCS-DEF-5 (sibling plan, parallel scheduler).
  //
  // BCS-DEF-4-TG (2026-05-20) — replaces the BCS-DEF-4 placeholder
  // with the active bind workflow. Master switch state + current
  // binding status are server-side reads here; the client component
  // owns the Server Action invocations.
  const isTeacher = roles.includes('teacher')

  let learnerTgBound = false
  let learnerTgChatId: string | null = null
  let learnerTgMasterSwitch = false
  if (!isTeacher) {
    const pool = getAuthPool()
    const bindRow = await pool.query<{
      learner_telegram_enabled: boolean
      learner_telegram_chat_id: string | null
    }>(
      `select learner_telegram_enabled, learner_telegram_chat_id
         from accounts where id = $1::uuid`,
      [account.id],
    )
    if (bindRow.rows[0]) {
      learnerTgBound = bindRow.rows[0].learner_telegram_enabled === true
      learnerTgChatId = bindRow.rows[0].learner_telegram_chat_id ?? null
    }
    const settings = await resolveOperatorSettingsForProbe('learner-reminders')
    learnerTgMasterSwitch =
      settings.LEARNER_REMINDERS_TELEGRAM_ENABLED?.value === 1
  }

  // BCS-DEF-4-PUSH (2026-06-06) — Web Push subscription state (4-state
  // contract per plan §3.9). `disabled` → section hidden; other states
  // render the client island.
  const pushState = !isTeacher
    ? await resolveLearnerPushState(account.id)
    : null

  // 2026-06-02 (verstka fix): wrap the page in a wider centered column
  // than the default AuthShell maxWidth: 440. The form + cards stack
  // looked drifted-to-the-right and visually unbalanced — the section
  // headings and Имя/Фамилия grid breathe better at 640.
  return (
    <>
      <SiteHeader />
      <main
        className="auth-shell-main saas-chrome"
        style={{
          minHeight: 'calc(100vh - 56px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '48px 24px 96px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
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
              E-mail ещё не подтверждён. Откройте письмо, которое мы отправили
              при регистрации, и нажмите ссылку в нём. Если письма нет —{' '}
              <ResendVerifyButton />.
            </AuthInfoBox>
          ) : null}

          <ProfileEditor
            initialProfile={profile}
            fallbackEmail={account.email}
          />

          {!isTeacher ? (
            <LearnerTelegramBinding
              initialBound={learnerTgBound}
              initialChatId={learnerTgChatId}
              masterSwitchOn={learnerTgMasterSwitch}
            />
          ) : null}

          {!isTeacher && pushState && pushState.kind !== 'disabled' ? (
            <LearnerPushSubscription initialState={pushState} />
          ) : null}

          <DangerZone />
        </div>
      </main>
    </>
  )
}

