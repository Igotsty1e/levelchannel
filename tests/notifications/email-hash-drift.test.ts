// BCS-DEF-4-PUSH (2026-06-06) — pins TS↔.mjs email-hash equality so the
// scheduler-side audit writer emits the SAME `email_hash` that the
// TS-side writers do for the same email.

import { describe, expect, it, beforeEach } from 'vitest'

import { hashEmailForRateLimit } from '@/lib/auth/email-hash'
// @ts-expect-error - .mjs untyped
import { hashEmailForAudit } from '@/scripts/lib/email-hash.mjs'

describe('email-hash drift TS↔mjs', () => {
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_SECRET = 'test-secret-deterministic-1234'
  })

  it('hashes identical for the same email', () => {
    const email = 'Учащийся@Example.RU'
    expect(hashEmailForAudit(email)).toBe(hashEmailForRateLimit(email))
  })

  it('hashes identical after normalization (case + whitespace)', () => {
    const a = '  USER@example.com  '
    const b = 'user@example.com'
    expect(hashEmailForAudit(a)).toBe(hashEmailForRateLimit(b))
  })

  it('differs for different emails', () => {
    expect(hashEmailForAudit('a@x.ru')).not.toBe(hashEmailForAudit('b@x.ru'))
  })
})
