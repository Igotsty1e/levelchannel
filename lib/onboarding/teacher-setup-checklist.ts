// Server-side helper for the `teacher_setup_checklist` onboarding hint
// per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`.
//
// Computes the 4-item completion state for the teacher's
// home-page setup checklist:
//   1. Profile filled (`account_profiles.display_name IS NOT NULL AND
//      account_profiles.timezone IS NOT NULL`) — timezone added
//      2026-06-05 in calendar-onboarding-cleanup wave: without timezone
//      the calendar step is unreachable, so a teacher seeing «Заполнить
//      профиль ✓» while still blocked at the calendar gate is misleading.
//   2. At least one tariff created (`pricing_tariffs` row)
//   3. Calendar integration active or degraded (`getGoogleIntegrationMeta`)
//   4. At least one invite sent (`teacher_invites` row)
//
// All four predicates are tiny existence checks — keep them in one
// helper so the home page calls a single function and gets a typed
// shape back. The render decision (show / hide / dismissed-but-resurface)
// is made by the consumer component.

import { getAccountProfile } from '@/lib/auth/profiles'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'
import { getDbPool } from '@/lib/db/pool'
import { getOnboardingState } from '@/lib/onboarding/state'

export type TeacherSetupChecklistState = {
  /** True when the corresponding step is complete. */
  profileFilled: boolean
  tariffCreated: boolean
  calendarConnected: boolean
  inviteSent: boolean
  /** True when ALL four steps are complete — checklist hidden regardless of dismiss state. */
  allComplete: boolean
  /** True when the user dismissed the hint earlier via the dismiss-hint API. */
  dismissed: boolean
}

export async function computeTeacherSetupChecklist(
  teacherAccountId: string,
): Promise<TeacherSetupChecklistState> {
  const pool = getDbPool()
  const [profile, tariff, calendar, invite, state] = await Promise.all([
    getAccountProfile(teacherAccountId),
    pool.query<{ exists: boolean }>(
      `select exists(select 1 from pricing_tariffs where teacher_id = $1::uuid) as exists`,
      [teacherAccountId],
    ),
    getGoogleIntegrationMeta(teacherAccountId).catch(() => null),
    pool.query<{ exists: boolean }>(
      `select exists(select 1 from teacher_invites where teacher_account_id = $1::uuid) as exists`,
      [teacherAccountId],
    ),
    getOnboardingState(teacherAccountId),
  ])

  const profileFilled = Boolean(profile?.displayName && profile?.timezone)
  const tariffCreated = Boolean(tariff.rows[0]?.exists)
  const calendarConnected =
    calendar?.syncState === 'active' || calendar?.syncState === 'degraded'
  const inviteSent = Boolean(invite.rows[0]?.exists)
  const allComplete =
    profileFilled && tariffCreated && calendarConnected && inviteSent
  const dismissed = 'teacher_setup_checklist' in state.dismissedHints

  return {
    profileFilled,
    tariffCreated,
    calendarConnected,
    inviteSent,
    allComplete,
    dismissed,
  }
}
