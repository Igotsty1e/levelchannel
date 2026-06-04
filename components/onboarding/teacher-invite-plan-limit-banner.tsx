// Teacher onboarding: SSR-conditional banner shown above the invite
// list when the teacher approaches OR has reached the learner limit
// for their plan tier.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`
// (`teacher-invite-plan-limit-banner`):
//   - if M >= N: hard-limit copy (invite button disabled by separate
//     server-side gate; this banner just explains).
//   - else if M >= ceil(0.8 * N): soft-limit warning.
//   - else: nothing rendered.
//
// `unlimited` tier (plan-4 / operator-managed) — banner never renders.
//
// Not dismissible (conditional banner — hides itself when the predicate
// flips false). Not persisted.

import { pluralRu } from '@/lib/copy/plural-ru'
import type { TeacherPlanLearnerLimit } from '@/lib/onboarding/teacher-plan-limit'

export function TeacherInvitePlanLimitBanner({
  limit,
}: {
  limit: TeacherPlanLearnerLimit
}) {
  if (limit.kind === 'unlimited') return null
  const { activeCount, limit: N, planTitleRu } = limit
  const isHardLimit = activeCount >= N
  const isSoftLimit = !isHardLimit && activeCount >= Math.ceil(0.8 * N)
  if (!isHardLimit && !isSoftLimit) return null

  const learnerWord = pluralRu(
    N,
    'активный ученик',
    'активных ученика',
    'активных учеников',
  )

  return (
    <div
      role={isHardLimit ? 'alert' : 'status'}
      aria-live={isHardLimit ? 'assertive' : 'polite'}
      style={{
        padding: '12px 14px',
        marginBottom: 16,
        borderRadius: 6,
        background: isHardLimit
          ? 'rgba(224, 118, 118, 0.12)'
          : 'rgba(110, 168, 254, 0.10)',
        border: `1px solid ${
          isHardLimit ? 'var(--danger, #e07676)' : 'var(--accent, #6ea8fe)'
        }`,
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      {isHardLimit ? (
        <>
          Достигнут лимит активных учеников на тарифе{' '}
          <strong>{planTitleRu}</strong> ({activeCount}/{N}). Чтобы
          пригласить ещё, обновите тариф или архивируйте неактивных учеников.
        </>
      ) : (
        <>
          На тарифе <strong>{planTitleRu}</strong> вы можете пригласить{' '}
          {N} {learnerWord}. Сейчас активных: {activeCount}/{N}.
        </>
      )}
    </div>
  )
}
