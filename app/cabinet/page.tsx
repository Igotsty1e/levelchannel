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
  listSlotsForLearner,
} from '@/lib/scheduling/slots'

import { DangerZone } from './danger-zone'
import { LessonsSection } from './lessons-section'
import { LogoutButton } from './logout-button'
import { ProfileEditor } from './profile-editor'
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

  // Phase 6+: only surface open slots from the learner's assigned
  // teacher. If there's no assignment yet, openSlots stays empty and
  // the cabinet renders a "ваш учитель ещё не назначен" hint.
  const [profile, roles, mySlots, openSlots] = await Promise.all([
    getAccountProfile(account.id),
    listAccountRoles(account.id),
    listSlotsForLearner(account.id, 20),
    account.assignedTeacherId
      ? listOpenFutureSlots({
          teacherAccountId: account.assignedTeacherId,
          limit: 50,
        })
      : Promise.resolve([]),
  ])
  const isAdmin = roles.includes('admin')
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

      {isAdmin ? (
        <div className="card" style={{ padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            У этого аккаунта есть роль <code>admin</code>. Перейти в{' '}
            <a href="/admin" style={{ color: 'var(--accent)' }}>
              админку
            </a>
            .
          </p>
        </div>
      ) : null}

      <ProfileEditor initialProfile={profile} fallbackEmail={account.email} />

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
