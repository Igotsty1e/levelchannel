// BCS-DEF-5 (2026-05-19) — TS mirror of scripts/lib/plural-ru.mjs.
//
// The TS surface exists so unit tests can import the helper with type
// safety and so any future TS callers (e.g. server-rendered admin
// pages) don't re-implement the rule. A drift test pins per-input
// equality with the mjs mirror.
//
// Russian plural rules per `docs/content-style.md §10`:
//   - mod10 === 1 and mod100 !== 11  → singular ("1 занятие")
//   - mod10 in [2,3,4] and mod100 not in [12,13,14] → few ("2 занятия")
//   - else                            → many ("5 занятий", "11 занятий")

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
