// security-audit-2026-06-02 Sub-PR 2 (F2 closure) — shared
// constant-time string equality for secret comparisons.
//
// Extracted from lib/api/cron-auth.ts (the project standard); shared
// here so the Telegram webhook secret check + any future secret-token
// surface compares can use the same primitive instead of `!==`.
//
// Contract: same length AND every byte XOR is zero. The early
// length-mismatch branch is acceptable — secret tokens are
// fixed-length (Telegram bot api secret tokens, cron shared
// secrets), so length leakage carries no useful information.
// `crypto.timingSafeEqual` is the Node primitive; this string
// variant avoids the Buffer alloc and is the established pattern.

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
