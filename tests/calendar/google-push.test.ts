import { describe, expect, it, vi } from 'vitest'

import {
  deleteEvent,
  deterministicEventId,
  insertEventIdempotent,
  patchEvent,
} from '@/lib/calendar/google/push'

const SLOT_UUID = '11111111-2222-3333-4444-555555555555'
const OWNERSHIP = {
  lcOrigin: 'levelchannel' as const,
  lcSlotId: SLOT_UUID,
  lcEpoch: 'epoch-x',
}

function mockResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

describe('deterministicEventId', () => {
  it('produces base32hex string with letter-start prefix (Google accepts 0-9a-v, must start with letter)', () => {
    const id = deterministicEventId(SLOT_UUID)
    expect(id.startsWith('lc')).toBe(true)
    expect(id).toMatch(/^lc[0-9a-v]+$/) // base32hex per Google docs
    expect(id.length).toBeGreaterThanOrEqual(5)
    expect(id.length).toBeLessThanOrEqual(1024)
  })

  it('is deterministic across calls', () => {
    expect(deterministicEventId(SLOT_UUID)).toBe(deterministicEventId(SLOT_UUID))
  })

  it('throws on non-UUID input', () => {
    expect(() => deterministicEventId('not-a-uuid')).toThrow(/UUID/)
  })

  it('accepts UUID with/without dashes', () => {
    const a = deterministicEventId(SLOT_UUID)
    const b = deterministicEventId(SLOT_UUID.replace(/-/g, ''))
    expect(a).toBe(b)
  })
})

describe('insertEventIdempotent', () => {
  it('happy 200 path: returns the event, reused=false', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.id).toBe(deterministicEventId(SLOT_UUID))
      expect(body.extendedProperties.shared.lc_origin).toBe('levelchannel')
      expect(body.extendedProperties.shared.lc_slot_id).toBe(SLOT_UUID)
      expect(body.extendedProperties.shared.lc_epoch).toBe('epoch-x')
      return mockResp({
        id: body.id,
        etag: '"e1"',
        extendedProperties: {
          shared: {
            lc_origin: 'levelchannel',
            lc_slot_id: SLOT_UUID,
            lc_epoch: 'epoch-x',
          },
        },
      })
    }) as unknown as typeof fetch

    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'LC: pupil 12:00',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reused).toBe(false)
      expect(r.event.id).toBe(deterministicEventId(SLOT_UUID))
    }
  })

  it('409 + matching ownership: returns reused=true after events.get', async () => {
    let call = 0
    const expectedId = deterministicEventId(SLOT_UUID)
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) return mockResp({ error: { message: 'conflict' } }, 409)
      return mockResp({
        id: expectedId,
        etag: '"e2"',
        extendedProperties: {
          shared: {
            lc_origin: 'levelchannel',
            lc_slot_id: SLOT_UUID,
            lc_epoch: 'epoch-x',
          },
        },
      })
    }) as unknown as typeof fetch
    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'S',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reused).toBe(true)
  })

  it('409 with private-only ownership (shared stripped) → ownership_mismatch (shared is authority per Codex E.1 review)', async () => {
    const expectedId = deterministicEventId(SLOT_UUID)
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) return mockResp({ error: 'conflict' }, 409)
      return mockResp({
        id: expectedId,
        etag: '"e"',
        extendedProperties: {
          // shared deliberately missing — only private has lc_slot_id.
          // Per F8 contract, shared is the authority; we MUST refuse.
          private: { lc_slot_id: SLOT_UUID },
        },
      })
    }) as unknown as typeof fetch
    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'S',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('ownership_mismatch')
  })

  it('409 + foreign ownership: returns ownership_mismatch error', async () => {
    const expectedId = deterministicEventId(SLOT_UUID)
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) return mockResp({ error: 'conflict' }, 409)
      return mockResp({
        id: expectedId,
        etag: '"e"',
        extendedProperties: {
          shared: {
            lc_origin: 'levelchannel',
            lc_slot_id: 'not-our-slot',
            lc_epoch: 'epoch-x',
          },
        },
      })
    }) as unknown as typeof fetch
    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'S',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'ownership_mismatch') {
      expect(r.error.foreignSlotId).toBe('not-our-slot')
    }
  })

  it('non-409 HTTP error bubbles up', async () => {
    const fetchMock = vi.fn(async () => mockResp('forbidden', 403)) as unknown as typeof fetch
    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'S',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') expect(r.error.status).toBe(403)
  })

  it('network error', async () => {
    const fetchMock = (async () => {
      throw new Error('ETIMEDOUT')
    }) as unknown as typeof fetch
    const r = await insertEventIdempotent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      slotId: SLOT_UUID,
      input: {
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T10:00:00Z',
        summary: 'S',
        ownership: OWNERSHIP,
      },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('network')
  })
})

describe('patchEvent', () => {
  it('PATCHes only the provided fields', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.summary).toBe('NEW')
      expect(body.start.dateTime).toBe('2026-07-02T10:00:00Z')
      expect(body.description).toBeUndefined()
      return mockResp({ id: 'evt', etag: '"e"' })
    }) as unknown as typeof fetch
    const r = await patchEvent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      eventId: 'evt',
      input: { summary: 'NEW', startAt: '2026-07-02T10:00:00Z' },
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
  })
})

describe('deleteEvent', () => {
  it.each([200, 204, 404, 410])('treats %d as terminal-success', async (status) => {
    const fetchMock = vi.fn(async () => mockResp('', status)) as unknown as typeof fetch
    const r = await deleteEvent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      eventId: 'evt',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe(status)
  })

  it('returns http error for other 4xx', async () => {
    const fetchMock = vi.fn(async () => mockResp('forbidden', 403)) as unknown as typeof fetch
    const r = await deleteEvent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      eventId: 'evt',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') expect(r.error.status).toBe(403)
  })

  it('returns http error for 5xx (caller decides retry)', async () => {
    const fetchMock = vi.fn(async () => mockResp('outage', 503)) as unknown as typeof fetch
    const r = await deleteEvent({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      eventId: 'evt',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') expect(r.error.status).toBe(503)
  })
})
