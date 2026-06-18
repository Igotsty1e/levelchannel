// 2026-06-18 codex-audit BLOCKER §5.1 fix — token-versioning regression.
//
// Защищаем от регрессии 4-х свойств:
// 1. Старый token (HMAC over только accountId, без version+expiresAt)
//    больше не валиден.
// 2. Token с другой version — отвергается (per-account revoke работает).
// 3. Истёкший token — отвергается (TTL соблюдается).
// 4. Валидный token (правильные accountId+version+expiresAt) — принимается.

import { beforeAll, describe, expect, it } from 'vitest'

import {
  signLearnerIcsToken,
  verifyLearnerIcsToken,
} from '@/lib/calendar/learner-ics'

const ACCOUNT_A = '11111111-1111-1111-1111-111111111111'

beforeAll(() => {
  process.env.LEARNER_ICS_TOKEN_SECRET =
    'test-fixture-ics-secret-min-32-chars-long-please'
})

describe('learner-ics token versioning (BLOCKER §5.1 fix)', () => {
  it('valid token verifies for matching (accountId, version)', () => {
    const token = signLearnerIcsToken(ACCOUNT_A, 1)
    expect(verifyLearnerIcsToken(ACCOUNT_A, 1, token)).toBe(true)
  })

  it('token signed for version=1 rejected when account bumps to version=2', () => {
    const token = signLearnerIcsToken(ACCOUNT_A, 1)
    // Симулируем bump: проверяем тот же токен с новой версией.
    expect(verifyLearnerIcsToken(ACCOUNT_A, 2, token)).toBe(false)
  })

  it('expired token rejected', () => {
    const pastMs = Date.now() - 60_000
    const token = signLearnerIcsToken(ACCOUNT_A, 1, pastMs)
    expect(verifyLearnerIcsToken(ACCOUNT_A, 1, token)).toBe(false)
  })

  it('token format must be expiresAtMs.hmacHex (regression on stripping)', () => {
    const token = signLearnerIcsToken(ACCOUNT_A, 1)
    expect(token).toMatch(/^\d+\.[a-f0-9]+$/)
  })

  it('malformed token without dot rejected', () => {
    // Старый формат — только HMAC, без префикса expiresAtMs — теперь невалидный.
    expect(verifyLearnerIcsToken(ACCOUNT_A, 1, 'abc123')).toBe(false)
  })

  it('token for wrong accountId rejected', () => {
    const token = signLearnerIcsToken(ACCOUNT_A, 1)
    const wrongAccount = '22222222-2222-2222-2222-222222222222'
    expect(verifyLearnerIcsToken(wrongAccount, 1, token)).toBe(false)
  })
})
