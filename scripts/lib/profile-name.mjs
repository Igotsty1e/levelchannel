// TASK-5 (2026-05-23) — mjs twin of lib/auth/profile-name.ts.
//
// Plan: docs/plans/teacher-cabinet-polish.md §2.1 + Q-10 closure.
//
// Same semantics as the TS module, used by the cron entry point
// (scripts/teacher-daily-digest.mjs greeting). Kept aligned by hand;
// a future refactor can lift both into a shared .sql + json contract.

function joinNames(firstName, lastName) {
  const f = typeof firstName === 'string' ? firstName.trim() : ''
  const l = typeof lastName === 'string' ? lastName.trim() : ''
  return `${f} ${l}`.trim()
}

/**
 * Render a profile name for display, with email fallback.
 *
 * @param {{firstName?: string|null, lastName?: string|null, displayName?: string|null, fallbackEmail: string}} input
 * @returns {string}
 */
export function formatProfileNameForRender(input) {
  const joined = joinNames(input.firstName, input.lastName)
  if (joined.length > 0) return joined
  const dn =
    typeof input.displayName === 'string' ? input.displayName.trim() : ''
  if (dn.length > 0) return dn
  return input.fallbackEmail
}

/**
 * @param {{firstName?: string|null, lastName?: string|null}} input
 * @returns {string|null}
 */
export function computeDisplayNameForStorage(input) {
  const joined = joinNames(input.firstName, input.lastName)
  return joined.length > 0 ? joined : null
}

/**
 * @param {string|null|undefined} displayName
 * @returns {{firstName: string|null, lastName: string|null}}
 */
export function splitDisplayName(displayName) {
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
