// BCS-DEF-5 (2026-05-19) — Russian plural-form helper extracted from
// scripts/conflict-unresolved-alert.mjs (previously inlined). The
// digest email template imports this canonical version.
//
// Russian plural rules per `docs/content-style.md §10`:
//   - mod10 === 1 and mod100 !== 11  → singular ("1 занятие")
//   - mod10 in [2,3,4] and mod100 not in [12,13,14] → few ("2 занятия")
//   - else                            → many ("5 занятий", "11 занятий")
//
// MUST stay in lockstep with lib/copy/plural-ru.ts (TS mirror, used for
// types + drift tests).
//
// Plan: docs/plans/bcs-def-5-teacher-reminders.md §1.1 + §2.5.

/**
 * Pick the right Russian plural form for an integer count.
 *
 * @param {number} n     non-negative integer
 * @param {string} one   singular form (e.g. 'занятие')
 * @param {string} few   2-4 form (e.g. 'занятия')
 * @param {string} many  5+ form (e.g. 'занятий')
 * @returns {string}
 */
export function pluralRu(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
