/**
 * Russian noun pluralisation. Three forms:
 *   - `one`  (1, 21, 31, …)            → «1 ученик_у», «21 урок»
 *   - `few`  (2-4, 22-24, …)          → «2 ученикам», «3 урока»
 *   - `many` (0, 5-20, 25-30, 11-14)   → «5 учеников», «11 уроков», «0 уроков»
 *
 * Edge case: 11-14 falls in the `many` bucket (NOT `few`), which is
 * the most common mistake when teams roll their own helper. We hard-
 * test it.
 */

export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
