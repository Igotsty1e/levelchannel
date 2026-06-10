/**
 * Search-normalisation helpers. Currently:
 *   - lower-case
 *   - ё → е, й → и (so search «петр» matches «Пётр», «семен» matches «Семён»)
 *   - trim
 *
 * Used by client-side filtering in `<Combobox>` and any other
 * picker-style UI where the teacher types Russian names into a
 * search box.
 */

export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/й/g, 'и')
    .trim()
}
