import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { AuthInfoBox } from '@/components/auth-form-bits'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listSlotPaidStatus } from '@/lib/payments/allocations'
import {
  listOpenFutureSlots,
  listSlotsAsTeacher,
  listSlotsForLearner,
} from '@/lib/scheduling/slots'

import { DangerZone } from './danger-zone'
import { LessonsSection } from './lessons-section'
import { LogoutButton } from './logout-button'
import { ProfileEditor } from './profile-editor'
import { ResendVerifyButton } from './resend-verify-button'
import { TeacherSection } from './teacher-section'

// Server-side cabinet gate. Reads the session cookie directly (no HTTP
// round-trip to /api/auth/me) and SSR-redirects to /login when unauth'd.
// This avoids a flash of unauthenticated content.
//
// Role-based UI:
//   - admin (mutually exclusive with teacher/student) → redirect to
//     /admin. Admins don't have a learner workflow, so dropping them
//     here is the right shape.
//   - teacher → «Мои занятия как учитель» (read-only schedule)
//   - student-or-no-role → existing learner UI
//   - teacher + student → both sections shown
//   - email-unverified → banner + resend button (independent of role)

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

  const roles = await listAccountRoles(account.id)
  const isAdmin = roles.includes('admin')
  const isTeacher = roles.includes('teacher')

  // Admin lands on /admin instead of /cabinet — operator workflow,
  // separate UI surface. Mutually exclusive with teacher/student so
  // we don't lose any learner content this way.
  if (isAdmin) {
    redirect('/admin')
  }

  const [profile, mySlots, openSlots, teacherSlots] = await Promise.all([
    getAccountProfile(account.id),
    listSlotsForLearner(account.id, 20),
    account.assignedTeacherId
      ? listOpenFutureSlots({
          teacherAccountId: account.assignedTeacherId,
          limit: 50,
        })
      : Promise.resolve([]),
    isTeacher ? listSlotsAsTeacher(account.id, 50) : Promise.resolve([]),
  ])
  const greetingName = profile?.displayName?.trim() || account.email
  const paidMap = await listSlotPaidStatus(mySlots.map((s) => s.id))

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Личный кабинет
      </h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 24 }}>
        Здравствуйте,{' '}
        <span style={{ color: 'var(--text)' }}>{greetingName}</span>.
      </p>

      {!isVerified ? (
        <AuthInfoBox>
          E-mail ещё не подтверждён. Откройте письмо, которое мы отправили при
          регистрации, и нажмите ссылку в нём. Если письма нет —{' '}
          <ResendVerifyButton />.
        </AuthInfoBox>
      ) : null}

      <ProfileEditor initialProfile={profile} fallbackEmail={account.email} />

      {isTeacher ? (
        <TeacherSection
          initialSlots={teacherSlots}
          teacherTimezone={profile?.timezone ?? null}
        />
      ) : null}

      <LessonsSection
        initialMine={mySlots}
        initialAvailable={openSlots}
        learnerTimezone={profile?.timezone ?? null}
        emailVerified={isVerified}
        initialPaidSlotIds={Array.from(paidMap.keys())}
        hasAssignedTeacher={Boolean(account.assignedTeacherId)}
      />

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Кабинет в разработке
        </h2>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
          Здесь скоро появится:
        </p>
        <ul
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.8,
            paddingLeft: 20,
            marginTop: 8,
          }}
        >
          <li>оплата уроков и история платежей</li>
          <li>история занятий и материалы</li>
        </ul>
      </div>

      <DangerZone />

      <LogoutButton />
    </AuthShell>
  )
}
