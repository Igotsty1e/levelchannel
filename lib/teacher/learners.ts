/**
 * Lightweight learner-list shape for picker UIs (Combobox-driven
 * modals: IssuePackageModal, GrantTariffAccessModal).
 *
 * Drives the «Ученик» field in the package-issuance UX (plan
 * 2026-06-10 v3 §4.2). Scale assumption: a teacher has ≤30 active
 * learners — so the entire list is embedded into the page via an
 * SSR JSON-prop, no GET endpoint, no client-side pagination.
 *
 * Privacy (R10-2): email is NOT exposed as a separate field. We
 * collapse it into the single `label` (display name OR email if no
 * display name) so the DOM doesn't leak addresses unnecessarily.
 */

import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { listLearnersForTeacher } from '@/lib/scheduling/teacher-learners'

export type TeacherLearnerPickerOption = {
  id: string
  label: string
}

export async function listTeacherLearnersForPicker(
  teacherAccountId: string,
): Promise<TeacherLearnerPickerOption[]> {
  const learners = await listLearnersForTeacher(teacherAccountId)
  return learners
    .filter((l) => l.isAssigned)
    .map((l) => ({
      id: l.learnerId,
      label: formatProfileNameForRender({
        firstName: l.firstName ?? null,
        lastName: l.lastName ?? null,
        displayName: l.displayName,
        fallbackEmail: l.learnerEmail,
      }),
    }))
    .slice(0, 50) // safety cap
}
