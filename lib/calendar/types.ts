// Discriminated union DTO for the calendar surface. Wave A — every
// caller (admin, teacher, learner) gets a kind-narrowed view; absence
// of fields is part of the type, not just runtime.
//
// Codex review pinned this contract — Wave 7 #2 had a real DTO leak
// on `/api/slots/available`; the discriminator forces TypeScript
// callers to narrow per `kind` and prevents the same class of leak.

export type CalendarSlot =
  | {
      kind: 'open'
      id: string
      startAt: string // ISO UTC; UI renders in MSK
      durationMinutes: number
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'booked-self' // learner role only — own booking (Wave B)
      id: string
      startAt: string
      durationMinutes: number
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'booked-other' // learner role only — someone else's booking (Wave B)
      // NO id, NO learnerAccountId, NO learnerEmail, NO tariffAmount
      startAt: string
      durationMinutes: number
    }
  | {
      kind: 'booked-full' // admin / teacher view
      id: string
      startAt: string
      durationMinutes: number
      learnerAccountId: string
      learnerEmail: string
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'past-full' // admin / teacher — past slot with full identity
      id: string
      startAt: string
      durationMinutes: number
      status: 'completed' | 'no_show_learner' | 'no_show_teacher' | 'cancelled'
      learnerAccountId: string | null
      learnerEmail: string | null
    }
  | {
      kind: 'past-redacted' // learner Wave B — past slot, identity stripped
      id: string
      startAt: string
      durationMinutes: number
      status: 'completed' | 'no_show_learner' | 'no_show_teacher' | 'cancelled'
    }

export type CalendarResponse = {
  slots: CalendarSlot[]
  rangeStart: string // ISO MSK midnight (start of range)
  rangeEnd: string // ISO MSK midnight (exclusive)
  teacherId: string
  generatedAt: string // server timestamp for stale-state UX
}

// Active role precedence. Multi-role accounts (DB allows it even
// though `lib/auth/accounts.ts:255` actively prevents new grants) get
// resolved here. Pinned: admin > teacher > learner.
//
// "Learner" is a deny-list archetype — an account with NO role at all
// is treated as learner (per `lib/auth/guards.ts:74` comment block).
// New registrations get no role row by default; explicit 'student'
// role is also learner.
export type CalendarActiveRole = 'admin' | 'teacher' | 'learner'

export function pickActiveCalendarRole(
  roles: ReadonlyArray<string>,
): CalendarActiveRole | null {
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('teacher')) return 'teacher'
  // Anything else — explicit student OR no role — is learner archetype.
  return 'learner'
}
