import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { listAccountRoles } from '@/lib/auth/accounts'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getPaymentMethodForPair } from '@/lib/billing/learner-payment-method'
import { listAccountActivePackages } from '@/lib/billing/packages'
import { listPackageConsumedSlotIds } from '@/lib/billing/consumption'
import { listSlotPaymentState } from '@/lib/payments/allocations'
import { listClaimedOrConfirmedSlotIds } from '@/lib/payments/sbp-claims'
import {
  listOpenFutureSlots,
  listSlotsAsTeacher,
  listSlotsForLearner,
} from '@/lib/scheduling/slots'
import { getLearnerCancelWindowHours } from '@/lib/scheduling/policy'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { resolveMethodForLearner } from '@/lib/payments/sbp-methods'
import { greetingForHour } from '@/lib/util/greeting'

import { loadTeacherBlocks } from '@/lib/cabinet/teacher-blocks'
import { shouldShowLearnerCabinetTour } from '@/lib/onboarding/learner-cabinet-tour'
import { getOnboardingState } from '@/lib/onboarding/state'

import { LearnerAfterBookReminder } from '@/components/onboarding/learner-after-book-reminder'
import { LearnerCabinetTour } from '@/components/onboarding/learner-cabinet-tour'
import { LearnerPaymentsExplainer } from '@/components/cabinet/payments-explainer'

import { Banner, Button, EmptyState } from '@/components/ui/primitives'

import { BillingSections } from './billing-sections'
import { LessonsSection } from './lessons-section'
import { VerifyEmailReminderDismissButton } from '@/components/onboarding/verify-email-reminder-dismiss'

import { ResendVerifyButton } from './resend-verify-button'
import { TeacherBlocksList } from './teacher-blocks-list'
import { TeacherInviteSection } from './teacher-invite-section'
import { TeacherLearnersSection } from './teacher-learners-section'
import { TeacherSection } from './teacher-section'
import { UnifiedTimeline } from './unified-timeline'

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

export default async function CabinetPage({
  searchParams,
}: {
  // Next 16 — searchParams is a Promise per the new dynamic-API contract.
  searchParams?: Promise<{ booked?: string | string[] }>
}) {
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
  // blocks (Мои занятия / Записаться / Мои пакеты / К оплате) which
  // had nothing to do with their workflow.
  const isLearner = isStudent || roles.length === 0

  // Admin lands on /admin instead of /cabinet — operator workflow,
  // separate UI surface. Mutually exclusive with teacher/student so
  // we don't lose any learner content this way.
  if (isAdmin) {
    redirect('/admin')
  }

  // 2026-06-02 fix: teacher-only accounts (no student role) belong on
  // /teacher (their canonical home). They were previously stuck on
  // /cabinet which is the learner surface — the «Мои занятия как
  // учитель» fallback block was visible but the page label / nav /
  // CTAs all assumed a learner. The teacher home page at /teacher
  // owns the proper teacher dashboard (lessons preview, learners
  // list, digest preview). Teacher+student dual-role stays on
  // /cabinet so the learner blocks remain reachable.
  // Onboarding Sub-PR A (round-7 SIGN-OFF closure for BLOCKER #2): the
  // teacher-only redirect was creating a /teacher↔/cabinet loop for
  // unverified teachers — /teacher/layout.tsx:50 redirects unverified
  // teachers to /cabinet, and the cabinet bounced them back. We keep
  // unverified teacher-only accounts on /cabinet so the existing
  // verify-email banner (rendered below) is reachable. Verified
  // teacher-only accounts still go to /teacher (their canonical home).
  if (isTeacher && !isStudent && account.emailVerifiedAt !== null) {
    redirect('/teacher')
  }

  // SAAS-PIVOT Day 2 (2026-05-22) codex-paranoia round-2 WARN #3
  // closure — derive the cabinet's "primary teacher" from the n:m
  // canonical array, not from the legacy single-value alias.
  //
  // SAAS-PIVOT Day 7 (Epic 7 — multi-teacher polish): for 2+ active
  // links we render a per-teacher block list + a unified timeline
  // instead of the single-teacher LessonsSection. For 0/1 links the
  // surface is unchanged from Day 2.
  const teacherIds = isLearner ? account.assignedTeacherIds : []
  const linkCount = teacherIds.length
  const primaryTeacherId = isLearner ? (teacherIds[0] ?? null) : null
  const hasAnyTeacher = isLearner && linkCount > 0
  const isMultiTeacher = isLearner && linkCount >= 2

  const [
    profile,
    mySlots,
    openSlots,
    teacherSlots,
    teacherLearners,
    activePackages,
    // SAAS-PIVOT Day 7 (Epic 7) — per-teacher blocks fetched only for
    // multi-link learners. Single-link learners keep the v1 surface
    // (LessonsSection) unchanged. Zero-link learners get the empty-
    // state hint, no blocks to render.
    teacherBlocks,
    // Bug #1 (2026-06-02). Single-link learner only: derive
    // paymentMethodNotSet so the cabinet renders the missing-payment-
    // method banner above the «Открыть календарь» CTA instead of
    // letting the learner discover the booking-side reject inside
    // the Calendly confirm screen. Multi-link learners get this per-
    // block via loadTeacherBlocks (single SoT). Plan: docs/plans/bug-
    // 1-payment-method-banner.md §A + §D.
    primaryTeacherPaymentMethod,
  ] = await Promise.all([
    getAccountProfile(account.id),
    isLearner ? listSlotsForLearner(account.id, 20) : Promise.resolve([]),
    // Single-teacher only — multi-teacher view defers slot discovery to
    // /cabinet/book?teacher=<id> from the per-teacher block CTA.
    isLearner && !isMultiTeacher && primaryTeacherId
      ? listOpenFutureSlots({
          teacherAccountId: primaryTeacherId,
          limit: 50,
        })
      : Promise.resolve([]),
    isTeacher ? listSlotsAsTeacher(account.id, 50) : Promise.resolve([]),
    isTeacher ? listLearnersForTeacher(account.id) : Promise.resolve([]),
    // Wave 18 — billing context for the BookConfirmModal preview.
    // Only loaded for learners; pure read, no mutation.
    isLearner ? listAccountActivePackages(account.id) : Promise.resolve([]),
    isMultiTeacher
      ? loadTeacherBlocks(account.id, teacherIds)
      : Promise.resolve([]),
    isLearner && !isMultiTeacher && primaryTeacherId
      ? getPaymentMethodForPair(primaryTeacherId, account.id)
      : Promise.resolve('none' as const),
  ])

  // teacher-payments-sbp-self-service Sub-PR C: enabled когда у учителя
  // есть active SBP method (default или per-learner assignment).
  const sbpPayEnabled =
    isLearner && !isMultiTeacher && primaryTeacherId
      ? (await resolveMethodForLearner(primaryTeacherId, account.id)) !== null
      : false

  // PKG-LEARNER-BUY epic-close WARN #3 — server SoT for "should the
  // BillingSections show the Купить пакет CTA?". Matches the same
  // predicate /cabinet/packages + /api/checkout/package/[slug] use.
  const canBuyPackages = isLearner
    ? await isLearnerArchetypeCandidate(account.id)
    : false
  const greetingName = formatProfileNameForRender({
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    displayName: profile?.displayName ?? null,
    fallbackEmail: account.email,
  })
  // Wave 52 — pass two sets to <LessonsSection>: "paid" + "refunded".
  // A refunded slot needs a distinct neutral pill, not the yellow
  // "оплатить" CTA which would suggest the learner needs to pay again.
  const paymentStateMap = isLearner
    ? await listSlotPaymentState(mySlots.map((s) => s.id))
    : new Map<string, 'paid' | 'refunded'>()
  // SBP-claim covered slots (claimed/confirmed) гасим как paid, чтобы
  // UI не показывал кнопку «Оплатить» поверх уже отслеженной оплаты.
  const sbpClaimSlotIds = isLearner
    ? await listClaimedOrConfirmedSlotIds(mySlots.map((s) => s.id))
    : new Set<string>()
  // 2026-06-12 payments-copy-and-states: третий канал оплаты —
  // package consumption. Раньше только paidSet/sbpClaimSlotIds
  // прятали кнопку «Оплатить», package-covered слоты пролетали мимо.
  // Ученик жал «Оплатить» → API возвращал already_paid (вся проверка
  // на сервере OK), но UI показывал raw англ. строку. Добавляем сет
  // package-covered ids в общий список paid.
  const packageConsumedSlotIds = isLearner
    ? await listPackageConsumedSlotIds(account.id)
    : new Set<string>()
  const paidSlotIds: string[] = []
  const refundedSlotIds: string[] = []
  for (const [slotId, state] of paymentStateMap) {
    if (state === 'paid') paidSlotIds.push(slotId)
    else refundedSlotIds.push(slotId)
  }
  for (const slotId of sbpClaimSlotIds) {
    if (!paidSlotIds.includes(slotId)) paidSlotIds.push(slotId)
  }
  for (const slotId of packageConsumedSlotIds) {
    if (!paidSlotIds.includes(slotId)) paidSlotIds.push(slotId)
  }
  // Bug #1 (2026-06-02). For single-link learners only — this is the
  // input to BookingCta's banner short-circuit. Multi-link learners
  // already carry their per-block paymentMethod on TeacherBlock.
  const paymentMethodNotSet =
    isLearner
    && !isMultiTeacher
    && Boolean(primaryTeacherId)
    && primaryTeacherPaymentMethod === 'none'

  // Onboarding Sub-PR C1 — learner welcome tour. Render predicate is
  // server-side per spec §1.2: hasTeacher && noCompletion && !dismissed.
  // Skipped for non-learner archetypes (teachers/admin who don't have
  // the cabinet learner UI rendered below).
  const showLearnerTour = isLearner
    ? await shouldShowLearnerCabinetTour(account.id)
    : false

  // Onboarding Sub-PR C3 — post-book reminder banner per spec §1.2 +
  // round-3 §0d Closure for BLOCKER #3. confirm-form pushes to
  // /cabinet?booked=1 right after a successful slot booking; we show
  // a banner offering to set up Telegram/email reminders until the
  // learner dismisses (`learner_reminder_hint` key).
  const sp = await searchParams
  const bookedFlag = Array.isArray(sp?.booked) ? sp.booked[0] : sp?.booked
  const justBooked = bookedFlag === '1'
  const reminderHintState = isLearner ? await getOnboardingState(account.id) : null
  const reminderHintDismissed = reminderHintState
    ? 'learner_reminder_hint' in reminderHintState.dismissedHints
    : false
  const showAfterBookReminder = isLearner && justBooked && !reminderHintDismissed

  // Sub-PR C CT1 — verify-email pending banner is dismissible. Mount the
  // hint card only when user has NOT dismissed it before.
  const verifyEmailHintState = !isVerified
    ? await getOnboardingState(account.id)
    : null
  const verifyEmailHintDismissed = verifyEmailHintState
    ? 'verify_email_reminder' in verifyEmailHintState.dismissedHints
    : false
  const showVerifyEmailHint = !isVerified && !verifyEmailHintDismissed

  // SBP self-service learner explainer №1 — «Как платить через СБП».
  // Видим только тем учащимся, у кого учитель уже принимает СБП.
  const sbpIntroState =
    isLearner && sbpPayEnabled ? await getOnboardingState(account.id) : null
  const sbpIntroDismissed = sbpIntroState
    ? 'learner_pay_sbp_intro' in sbpIntroState.dismissedHints
    : false
  const showSbpPayIntroExplainer =
    isLearner && sbpPayEnabled && !sbpIntroDismissed

  return (
    <AuthShell>
      {/* Cabinet header — 2026-06-07 round 3.
          Дублирующий H1 «Личный кабинет» убран: страница и есть кабинет.
          Шапка теперь только H1 с приветствием — кнопка «Профиль и
          настройки» переехала в самый низ страницы (см. ниже). «Выйти»
          живёт глобально в SiteHeader. */}
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {greetingForHour(new Date(), profile?.timezone ?? 'Europe/Moscow')},{' '}
          {greetingName}
        </h1>
      </header>

      {showVerifyEmailHint ? (
        <Banner
          tone="warning"
          action={<VerifyEmailReminderDismissButton />}
        >
          E-mail ещё не подтверждён. Откройте письмо, которое мы отправили
          при регистрации, и нажмите ссылку в нём. Если письма нет —{' '}
          <ResendVerifyButton />.
        </Banner>
      ) : null}

      {isTeacher ? (
        <>
          <TeacherSection
            initialSlots={teacherSlots}
            teacherTimezone={profile?.timezone ?? null}
          />
          <TeacherInviteSection isVerified={isVerified} />
          <TeacherLearnersSection learners={teacherLearners} />
        </>
      ) : null}

      {isLearner ? (
        <>
          {/* Onboarding Sub-PR C3 — post-book reminder banner. Renders
              ABOVE the welcome tour because it's the more urgent action
              when the learner just booked something. */}
          <LearnerAfterBookReminder shouldRender={showAfterBookReminder} />
          {/* Onboarding Sub-PR C1 — learner welcome tour shown only
              before the first lesson is completed. */}
          <LearnerCabinetTour shouldRender={showLearnerTour} />
          {showSbpPayIntroExplainer ? (
            <LearnerPaymentsExplainer
              hintKey="learner_pay_sbp_intro"
              initiallyDismissed={false}
            >
              <strong>Как платить за занятия.</strong> Кнопка{' '}
              <em>«Оплатить»</em> у каждого занятия откроет реквизиты СБП
              учителя — телефон и банк. Переведите сумму из своего банка и
              нажмите <em>«Я оплатил»</em>: учитель увидит вашу заявку и
              подтвердит. Платформа деньги не хранит — это прямой перевод
              между вами и учителем.
            </LearnerPaymentsExplainer>
          ) : null}
          {/* SAAS-PIVOT Day 7 — multi-teacher branch. 2+ active links:
              show per-teacher blocks + unified timeline. The single-
              teacher LessonsSection (booking CTA, paid pill, etc.) is
              not rendered here; multi-link learners book via the
              "Записаться к этому учителю" CTA per block which deep-
              links into /cabinet/book?teacher=<id>. */}
          {isMultiTeacher ? (
            <>
              <TeacherBlocksList
                blocks={teacherBlocks}
                learnerTimezone={profile?.timezone ?? null}
                canBuyPackages={canBuyPackages}
              />
              <UnifiedTimeline
                learnerAccountId={account.id}
                teacherLabelById={
                  new Map(
                    teacherBlocks.map((b) => [b.teacherId, b.teacherDisplayName]),
                  )
                }
                learnerTimezone={profile?.timezone ?? null}
              />
            </>
          ) : linkCount === 0 ? (
            <div style={{ marginBottom: 24 }}>
              <EmptyState
                title="Учитель пока не подключён"
                body={
                  <>
                    Попросите учителя прислать вам пригласительную ссылку.
                    Откройте её в этом браузере — и здесь появится ваше
                    расписание.
                  </>
                }
              />
            </div>
          ) : (
            <LessonsSection
              initialMine={mySlots}
              initialAvailable={openSlots}
              learnerTimezone={profile?.timezone ?? null}
              emailVerified={isVerified}
              initialPaidSlotIds={paidSlotIds}
              initialRefundedSlotIds={refundedSlotIds}
              hasAssignedTeacher={hasAnyTeacher}
              assignedTeacherId={primaryTeacherId}
              activePackages={activePackages.map((p) => ({
                id: p.id,
                titleSnapshot: p.titleSnapshot,
                durationMinutes: p.durationMinutes,
                countRemaining: p.countRemaining,
                countInitial: p.countInitial,
                expiresAt: p.expiresAt,
              }))}
              billingWaveActive={
                process.env.BILLING_WAVE_ACTIVE === 'true'
              }
              cancelWindowHours={getLearnerCancelWindowHours()}
              paymentMethodNotSet={paymentMethodNotSet}
              canBuyPackages={canBuyPackages}
              sbpPayEnabled={sbpPayEnabled}
            />
          )}

          <BillingSections
            learnerTimezone={profile?.timezone ?? null}
            canBuyPackages={canBuyPackages}
          />

          {/* «Профиль и настройки» — secondary action на самом дне
              кабинета (2026-06-07 owner ask). Раньше эта кнопка
              висела в шапке и конкурировала с приветствием — у учеников
              нет bottom-nav, поэтому единственный вход в /cabinet/profile
              мы оставляем, но переносим ниже основного контента. */}
          <div
            style={{
              marginTop: 8,
              marginBottom: 24,
              display: 'grid',
              gap: 8,
            }}
          >
            <Button
              variant="secondary"
              href="/cabinet/profile"
              fullWidth
            >
              Профиль и настройки
            </Button>
            <Button
              variant="ghost"
              href="/cabinet/payments"
              fullWidth
            >
              История оплат
            </Button>
          </div>
        </>
      ) : null}
    </AuthShell>
  )
}
