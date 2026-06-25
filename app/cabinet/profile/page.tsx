import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Banner } from '@/components/ui/primitives'
import { LearnerPushSubscription } from '@/components/cabinet/learner-push-subscription'
import { LearnerTelegramBinding } from '@/components/cabinet/learner-telegram-binding'
import { resolveOperatorSettingsForProbe } from '@/lib/admin/operator-settings'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { getAuthPool } from '@/lib/auth/pool'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { resolveLearnerPushState } from '@/lib/notifications/learner-push-state'

import { LearnerDangerCard } from '@/components/cabinet/learner-danger-card'
import { LearnerProfileCard } from '@/components/cabinet/learner-profile-card'
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
  // 2026-06-25 paranoia WARN #2 fix: teacher-only accounts направляются на
  // /teacher/profile где живёт TeacherProfileCard + TeacherDangerCard.
  // Раньше /cabinet/profile рендерил shared <ProfileEditor> + <DangerZone>
  // и был совместим с teacher view; после Bug 3 redesign под учнический
  // copy teacher-сессия видела бы неподходящий текст.
  //
  // 2026-06-25 paranoia round 2 WARN #2: unverified teacher-only НЕ редиректим
  // на /teacher/profile — там layout сразу шлёт назад на /cabinet
  // (app/teacher/layout.tsx:50). Это создаст loop. Pattern совпадает с
  // existing /cabinet handling (app/cabinet/page.tsx:121-124).
  const isStudent = roles.includes('student')
  const isTeacher = roles.includes('teacher')
  if (isTeacher && !isStudent && isVerified) {
    redirect('/teacher/profile')
  }

  const profile = await getAccountProfile(account.id)

  // BCS-DEF-4 (2026-05-19) — learner Telegram opt-in is a learner-only
  // feature; teachers' notifications surface ships separately in
  // BCS-DEF-5 (sibling plan, parallel scheduler).

  let learnerTgBound = false
  let learnerTgMasterSwitch = false
  if (!isTeacher) {
    const pool = getAuthPool()
    const bindRow = await pool.query<{
      learner_telegram_enabled: boolean
    }>(
      `select learner_telegram_enabled
         from accounts where id = $1::uuid`,
      [account.id],
    )
    if (bindRow.rows[0]) {
      learnerTgBound = bindRow.rows[0].learner_telegram_enabled === true
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
      {/* 2026-06-25 a11y: <SiteHeader> + <main> убраны — layout уже их даёт. */}
      <div
        className="saas-chrome"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '48px 24px 96px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
          {/* «Выйти» теперь в глобальном SiteHeader (2026-06-07); ранее
              дублировался отдельной кнопкой справа в этой шапке. */}
          <Link
            href="/cabinet"
            style={{
              color: 'var(--secondary)',
              textDecoration: 'none',
              fontSize: 14,
              display: 'inline-block',
              marginBottom: 16,
            }}
          >
            ← Назад в кабинет
          </Link>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              margin: 0,
              marginBottom: 24,
              letterSpacing: '-0.01em',
            }}
          >
            Профиль
          </h1>

          {!isVerified ? (
            <Banner tone="warning">
              E-mail ещё не подтверждён. Откройте письмо, которое мы
              отправили при регистрации, и нажмите ссылку в нём. Если
              письма нет — <ResendVerifyButton />.
            </Banner>
          ) : null}

          <LearnerProfileCard
            initialProfile={profile}
            fallbackEmail={account.email}
          />

          {!isTeacher ? (
            <LearnerTelegramBinding
              initialBound={learnerTgBound}
              masterSwitchOn={learnerTgMasterSwitch}
            />
          ) : null}

          {!isTeacher && pushState && pushState.kind !== 'disabled' ? (
            <LearnerPushSubscription initialState={pushState} />
          ) : null}

          <LearnerDangerCard />
        </div>
      </div>
    </>
  )
}
