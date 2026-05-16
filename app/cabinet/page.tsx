import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { AuthInfoBox } from '@/components/auth-form-bits'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listAccountActivePackages } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'
import { listSlotPaymentState } from '@/lib/payments/allocations'
import {
  listOpenFutureSlots,
  listSlotsAsTeacher,
  listSlotsForLearner,
} from '@/lib/scheduling/slots'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'

import { BillingSections } from './billing-sections'
import { DangerZone } from './danger-zone'
import { LessonsSection } from './lessons-section'
import { LogoutButton } from './logout-button'
import { ProfileEditor } from './profile-editor'
import { ResendVerifyButton } from './resend-verify-button'
import { TeacherLearnersSection } from './teacher-learners-section'
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
  const isStudent = roles.includes('student')
  // A user is rendered as a learner if they hold the explicit student
  // role OR they have no role at all (the default-learner contract).
  // Wave 14 #2 — a teacher-only account no longer sees learner-flow
  // blocks (Мои уроки / Записаться / Мои пакеты / К оплате) which
  // had nothing to do with their workflow.
  const isLearner = isStudent || roles.length === 0

  // Admin lands on /admin instead of /cabinet — operator workflow,
  // separate UI surface. Mutually exclusive with teacher/student so
  // we don't lose any learner content this way.
  if (isAdmin) {
    redirect('/admin')
  }

  const [
    profile,
    mySlots,
    openSlots,
    teacherSlots,
    teacherLearners,
    activePackages,
    postpaidRow,
  ] = await Promise.all([
    getAccountProfile(account.id),
    isLearner ? listSlotsForLearner(account.id, 20) : Promise.resolve([]),
    isLearner && account.assignedTeacherId
      ? listOpenFutureSlots({
          teacherAccountId: account.assignedTeacherId,
          limit: 50,
        })
      : Promise.resolve([]),
    isTeacher ? listSlotsAsTeacher(account.id, 50) : Promise.resolve([]),
    isTeacher ? listLearnersForTeacher(account.id) : Promise.resolve([]),
    // Wave 18 — billing context for the BookConfirmModal preview.
    // Only loaded for learners; pure read, no mutation.
    isLearner ? listAccountActivePackages(account.id) : Promise.resolve([]),
    isLearner
      ? getDbPool().query(
          'select postpaid_allowed from accounts where id = $1',
          [account.id],
        )
      : Promise.resolve({ rows: [] as Array<{ postpaid_allowed: boolean }> }),
  ])

  // PKG-LEARNER-BUY epic-close WARN #3 — server SoT for "should the
  // BillingSections show the Купить пакет CTA?". Matches the same
  // predicate /cabinet/packages + /api/checkout/package/[slug] use.
  const canBuyPackages = isLearner
    ? await isLearnerArchetypeCandidate(account.id)
    : false
  const greetingName = profile?.displayName?.trim() || account.email
  // Wave 52 — pass two sets to <LessonsSection>: "paid" + "refunded".
  // A refunded slot needs a distinct neutral pill, not the yellow
  // "оплатить" CTA which would suggest the learner needs to pay again.
  const paymentStateMap = isLearner
    ? await listSlotPaymentState(mySlots.map((s) => s.id))
    : new Map<string, 'paid' | 'refunded'>()
  const paidSlotIds: string[] = []
  const refundedSlotIds: string[] = []
  for (const [slotId, state] of paymentStateMap) {
    if (state === 'paid') paidSlotIds.push(slotId)
    else refundedSlotIds.push(slotId)
  }
  const postpaidAllowed = Boolean(postpaidRow.rows[0]?.postpaid_allowed)

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
        <>
          <TeacherSection
            initialSlots={teacherSlots}
            teacherTimezone={profile?.timezone ?? null}
          />
          <TeacherLearnersSection learners={teacherLearners} />
        </>
      ) : null}

      {isLearner ? (
        <>
          <LessonsSection
            initialMine={mySlots}
            initialAvailable={openSlots}
            learnerTimezone={profile?.timezone ?? null}
            emailVerified={isVerified}
            initialPaidSlotIds={paidSlotIds}
            initialRefundedSlotIds={refundedSlotIds}
            hasAssignedTeacher={Boolean(account.assignedTeacherId)}
            assignedTeacherId={account.assignedTeacherId}
            activePackages={activePackages.map((p) => ({
              id: p.id,
              titleSnapshot: p.titleSnapshot,
              durationMinutes: p.durationMinutes,
              countRemaining: p.countRemaining,
              countInitial: p.countInitial,
              expiresAt: p.expiresAt,
            }))}
            postpaidAllowed={postpaidAllowed}
            billingWaveActive={
              process.env.BILLING_WAVE_ACTIVE === 'true'
            }
          />

          <BillingSections
            learnerTimezone={profile?.timezone ?? null}
            canBuyPackages={canBuyPackages}
          />

          <div className="card" style={{ padding: 24, marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              Кабинет в разработке
            </h2>
            <p
              style={{
                color: 'var(--secondary)',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
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
        </>
      ) : null}

      <DangerZone />

      <LogoutButton />
    </AuthShell>
  )
}
