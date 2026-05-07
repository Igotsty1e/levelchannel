import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-07 #5 regression — DB invariant: a learner cannot book
// a slot where they are listed as the teacher.
//
// `requireLearnerArchetypeAndVerified` is a deny-list (rejects admin
// + teacher roles); it does NOT verify "this account is actually a
// student". An admin route can create a slot pairing a non-teacher
// account_id as `teacher_account_id`; if that account also has no
// teacher role, it passes the deny-list and could book itself. The
// `bookSlot` UPDATE WHERE clause now refuses this combination —
// `teacher_account_id <> $learner` — independently of any upstream
// validation.

const bookSlotMock = vi.fn()
const requireLearnerArchetypeAndVerifiedMock = vi.fn()

vi.mock('@/lib/scheduling/slots', () => ({
  bookSlot: (...a: unknown[]) => bookSlotMock(...a),
}))

vi.mock('@/lib/auth/guards', () => ({
  requireLearnerArchetypeAndVerified: () =>
    requireLearnerArchetypeAndVerifiedMock(),
}))

vi.mock('@/lib/security/request', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  enforceTrustedBrowserOrigin: vi.fn().mockReturnValue(null),
}))

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'

const VALID_UUID = '22222222-2222-2222-2222-222222222222'
const params = { params: Promise.resolve({ id: VALID_UUID }) }

function buildRequest() {
  return new Request(`https://levelchannel.ru/api/slots/${VALID_UUID}/book`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://levelchannel.ru',
    },
  })
}

describe('POST /api/slots/[id]/book — self-booking gate', () => {
  beforeEach(() => {
    bookSlotMock.mockReset()
    requireLearnerArchetypeAndVerifiedMock.mockReset()
    requireLearnerArchetypeAndVerifiedMock.mockResolvedValue({
      ok: true,
      account: { id: 'self-1', email: 'self@example.com' },
      session: { id: 's-1' },
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('translates self_booking_blocked → HTTP 403 with a clear message', async () => {
    bookSlotMock.mockResolvedValueOnce({
      ok: false,
      reason: 'self_booking_blocked',
    })
    const res = await bookHandler(buildRequest(), params)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('преподавателем')
  })

  it('still works for the happy path (200 with slot)', async () => {
    bookSlotMock.mockResolvedValueOnce({
      ok: true,
      slot: { id: VALID_UUID, status: 'booked' },
    })
    const res = await bookHandler(buildRequest(), params)
    expect(res.status).toBe(200)
  })
})
