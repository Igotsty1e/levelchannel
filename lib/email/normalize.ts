// Single source of truth for the email-normalization invariant used
// across auth (account lookup, login, register), payments (customer
// matching, webhook ownership), telemetry (PII hashing), and billing
// (package-grant dual-source corroboration).
//
// The invariant is `trim().toLowerCase()`. Migration 0010 enforces
// the same shape at the DB level for `accounts.email`. Drift here
// silently bypasses UNIQUE indexes and creates shadow accounts —
// see ENGINEERING_BACKLOG.md "Lesson learned 2026-04-29 — email
// normalization needs `.trim().toLowerCase()`, not just `.toLowerCase()`".
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
