import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-07 #3 regression — pin the route's disambiguation of
// `cancelLearnerSlot` outcomes. The race-safety lives in the SQL
// (atomic UPDATE WHERE status='booked' AND start_at - now() >= 24h);
// this test pins the HTTP-status mapping so a future refactor that
// drops a branch is caught.

const cancelLearnerSlotMock = vi.fn()
const requireLearnerArchetypeMock = vi.fn()

vi.mock('@/lib/scheduling/slots', () => ({
  cancelLearnerSlot: (...a: unknown[]) => cancelLearnerSlotMock(...a),
}))

vi.mock('@/lib/auth/guards', () => ({
  requireLearnerArchetype: () => requireLearnerArchetypeMock(),
}))

vi.mock('@/lib/security/request', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  enforceTrustedBrowserOrigin: vi.fn().mockReturnValue(null),
}))

import { POST as cancelHandler } from '@/app/api/slots/[id]/cancel/route'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

function buildRequest(body: unknown = {}) {
  return new Request(`https://levelchannel.ru/api/slots/${VALID_UUID}/cancel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://levelchannel.ru',
    },
    body: JSON.stringify(body),
  })
}

const fakeAuth = {
  ok: true as const,
  account: { id: 'learner-1', email: 'learner@example.com' },
  session: { id: 's-1' },
}

const params = { params: Promise.resolve({ id: VALID_UUID }) }

describe('POST /api/slots/[id]/cancel — Codex #3 disambiguation', () => {
  beforeEach(() => {
    cancelLearnerSlotMock.mockReset()
    requireLearnerArchetypeMock.mockReset()
    requireLearnerArchetypeMock.mockResolvedValue(fakeAuth)
  })

  afterEach(() => vi.restoreAllMocks())

  it('200 + slot on success', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: true,
      slot: { id: VALID_UUID, status: 'cancelled' },
    })

    const res = await cancelHandler(buildRequest(), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.slot.id).toBe(VALID_UUID)
  })

  it('404 on not_found', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: false,
      reason: 'not_found',
    })
    const res = await cancelHandler(buildRequest(), params)
    expect(res.status).toBe(404)
  })

  it('403 on not_owner', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: false,
      reason: 'not_owner',
    })
    const res = await cancelHandler(buildRequest(), params)
    expect(res.status).toBe(403)
  })

  it('409 on already_terminal — completed/no_show CANNOT be retro-cancelled', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: false,
      reason: 'already_terminal',
    })
    const res = await cancelHandler(buildRequest(), params)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('already_terminal')
  })

  it('403 + minutesUntilStart on too_late_to_cancel', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: false,
      reason: 'too_late_to_cancel',
      minutesUntilStart: 720,
    })
    const res = await cancelHandler(buildRequest(), params)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('too_late_to_cancel')
    expect(json.minutesUntilStart).toBe(720)
  })

  it('passes the learner account id (not the body) to cancelLearnerSlot', async () => {
    cancelLearnerSlotMock.mockResolvedValueOnce({
      ok: true,
      slot: { id: VALID_UUID, status: 'cancelled' },
    })
    await cancelHandler(buildRequest({ reason: 'busy' }), params)

    expect(cancelLearnerSlotMock).toHaveBeenCalledWith(
      VALID_UUID,
      'learner-1', // session learner id
      'busy',
    )
  })
})
