// TASK-5 (2026-05-23) — first_name + last_name helpers.
//
// Plan: docs/plans/teacher-cabinet-polish.md §2.1 + round-2 BLOCKER #3.
//
// Two DISTINCT helpers (deliberate split):
//
//   formatProfileNameForRender({ firstName, lastName, displayName, fallbackEmail })
//     — READ path. Used at every UI render site. Allowed to fall back
//       to email so the UI never shows a blank.
//
//   computeDisplayNameForStorage({ firstName, lastName })
//     — WRITE path. Used by PATCH writers + register UPSERT. Returns
//       NULL on empty (never falls back to email). The CHECK constraint
//       account_profiles_display_name_len is satisfied because empty
//       becomes NULL, not ''.
//
// splitDisplayName is the JS twin of the SQL backfill in mig 0095.
// Useful for tests + future migrations.
//
// No DB imports here — this is a pure module, bundle-safe for client
// island use (the cabinet ProfileEditor imports it from the client).

export type ProfileNameInput = {
  firstName: string | null | undefined
  lastName: string | null | undefined
}

export type ProfileRenderInput = ProfileNameInput & {
  displayName: string | null | undefined
  fallbackEmail: string
}

function joinNames(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const f = typeof firstName === 'string' ? firstName.trim() : ''
  const l = typeof lastName === 'string' ? lastName.trim() : ''
  return `${f} ${l}`.trim()
}

/**
 * Render a profile name for display, with email fallback.
 *
 * Precedence:
 *   1. trim(firstName + ' ' + lastName) — if non-empty
 *   2. displayName (back-compat for legacy rows pre-mig-0095)
 *   3. fallbackEmail (always set; cabinet always knows the email)
 */
export function formatProfileNameForRender(input: ProfileRenderInput): string {
  const joined = joinNames(input.firstName, input.lastName)
  if (joined.length > 0) return joined
  const dn =
    typeof input.displayName === 'string' ? input.displayName.trim() : ''
  if (dn.length > 0) return dn
  return input.fallbackEmail
}

/**
 * Compute the storage value for `account_profiles.display_name` from
 * first_name + last_name. Returns NULL on empty.
 *
 * Never falls back to email — that's a render concern, not storage.
 * The CHECK constraint account_profiles_display_name_len rejects ''
 * but accepts NULL, so empty input maps to NULL.
 */
export function computeDisplayNameForStorage(
  input: ProfileNameInput,
): string | null {
  const joined = joinNames(input.firstName, input.lastName)
  return joined.length > 0 ? joined : null
}

/**
 * Split a `display_name` into { firstName, lastName } the same way
 * the SQL backfill in mig 0095 does: trim, split on the FIRST space.
 * Empty / null returns { firstName: null, lastName: null }.
 *
 * Useful for back-compat paths + unit tests against the SQL backfill.
 */
export function splitDisplayName(
  displayName: string | null | undefined,
): { firstName: string | null; lastName: string | null } {
  if (typeof displayName !== 'string') {
    return { firstName: null, lastName: null }
  }
  const trimmed = displayName.trim()
  if (trimmed.length === 0) {
    return { firstName: null, lastName: null }
  }
  const idx = trimmed.indexOf(' ')
  if (idx < 0) {
    return { firstName: trimmed, lastName: null }
  }
  const first = trimmed.slice(0, idx).trim()
  const last = trimmed.slice(idx + 1).trim()
  return {
    firstName: first.length > 0 ? first : null,
    lastName: last.length > 0 ? last : null,
  }
}
