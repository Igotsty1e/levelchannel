import { describe, expect, it, vi } from 'vitest'

import {
  listCalendars,
  pullBusyIntervalsForCalendar,
  shapeEvent,
} from '@/lib/calendar/google/pull'

function mockJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

describe('shapeEvent', () => {
  it('parses a dateTime-bounded event into UTC ISO + summary', () => {
    const out = shapeEvent(
      {
        id: 'evt_1',
        summary: 'Dentist',
        start: { dateTime: '2026-05-20T09:00:00+03:00' },
        end: { dateTime: '2026-05-20T10:00:00+03:00' },
        etag: '"etag1"',
      },
      'primary',
    )
    expect(out).not.toBeNull()
    expect(out!.externalEventId).toBe('evt_1')
    expect(out!.summary).toBe('Dentist')
    expect(out!.isAllDay).toBe(false)
    expect(out!.startAt).toBe('2026-05-20T06:00:00.000Z')
    expect(out!.endAt).toBe('2026-05-20T07:00:00.000Z')
    expect(out!.etag).toBe('"etag1"')
  })

  it('parses an all-day event pinned to MSK midnight', () => {
    const out = shapeEvent(
      {
        id: 'allday_1',
        summary: 'Holiday',
        start: { date: '2026-05-09' },
        end: { date: '2026-05-10' },
      },
      'primary',
    )
    expect(out).not.toBeNull()
    expect(out!.isAllDay).toBe(true)
    // MSK midnight on 2026-05-09 = 2026-05-08T21:00:00.000Z
    expect(out!.startAt).toBe('2026-05-08T21:00:00.000Z')
    expect(out!.endAt).toBe('2026-05-09T21:00:00.000Z')
  })

  it('extracts extendedProperties.shared lc_* fields', () => {
    const out = shapeEvent(
      {
        id: 'evt_lc',
        start: { dateTime: '2026-05-20T09:00:00Z' },
        end: { dateTime: '2026-05-20T10:00:00Z' },
        extendedProperties: {
          shared: {
            lc_origin: 'levelchannel',
            lc_slot_id: 'slot-uuid',
            lc_epoch: 'epoch-xyz',
          },
        },
      },
      'primary',
    )
    expect(out!.lcOrigin).toBe('levelchannel')
    expect(out!.lcSlotId).toBe('slot-uuid')
    expect(out!.lcEpoch).toBe('epoch-xyz')
  })

  it('returns null when start >= end (zero-length or inverted)', () => {
    expect(
      shapeEvent(
        {
          id: 'evt',
          start: { dateTime: '2026-05-20T10:00:00Z' },
          end: { dateTime: '2026-05-20T10:00:00Z' },
        },
        'primary',
      ),
    ).toBeNull()
    expect(
      shapeEvent(
        {
          id: 'evt',
          start: { dateTime: '2026-05-20T11:00:00Z' },
          end: { dateTime: '2026-05-20T10:00:00Z' },
        },
        'primary',
      ),
    ).toBeNull()
  })

  it('skips cancelled events', () => {
    expect(
      shapeEvent(
        {
          id: 'evt',
          status: 'cancelled',
          start: { dateTime: '2026-05-20T10:00:00Z' },
          end: { dateTime: '2026-05-20T11:00:00Z' },
        },
        'primary',
      ),
    ).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(shapeEvent(null, 'primary')).toBeNull()
    expect(shapeEvent({ id: 'no-times' }, 'primary')).toBeNull()
    expect(
      shapeEvent({ id: '', start: { dateTime: 'x' }, end: { dateTime: 'y' } }, 'primary'),
    ).toBeNull()
  })

  it('returns null (not throws) on unparseable dateTime — Codex D.1 review fix', () => {
    // Pre-fix this threw RangeError from Date.toISOString and broke
    // the entire pull cycle. shapeEvent must be a total function.
    expect(() =>
      shapeEvent(
        {
          id: 'bad_dt',
          start: { dateTime: 'totally-not-a-date' },
          end: { dateTime: 'totally-not-a-date' },
        },
        'primary',
      ),
    ).not.toThrow()
    expect(
      shapeEvent(
        {
          id: 'bad_dt',
          start: { dateTime: 'totally-not-a-date' },
          end: { dateTime: 'totally-not-a-date' },
        },
        'primary',
      ),
    ).toBeNull()
  })

  it('returns null on unparseable all-day date string', () => {
    expect(
      shapeEvent(
        {
          id: 'bad_date',
          start: { date: 'NOPE-MM-DD' },
          end: { date: 'NOPE-MM-DD' },
        },
        'primary',
      ),
    ).toBeNull()
  })

  it('a single bad event in a pull batch does not abort the whole batch', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [
          {
            id: 'GOOD_1',
            start: { dateTime: '2026-05-20T09:00:00Z' },
            end: { dateTime: '2026-05-20T10:00:00Z' },
          },
          {
            id: 'BAD',
            start: { dateTime: 'garbage' },
            end: { dateTime: 'garbage' },
          },
          {
            id: 'GOOD_2',
            start: { dateTime: '2026-05-20T12:00:00Z' },
            end: { dateTime: '2026-05-20T13:00:00Z' },
          },
        ],
      }),
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // BAD dropped; the two GOOD events survived.
      expect(r.intervals.map((i) => i.externalEventId)).toEqual(['GOOD_1', 'GOOD_2'])
    }
  })
})

describe('pullBusyIntervalsForCalendar', () => {
  it('happy path: single page, returns parsed intervals', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [
          {
            id: 'A',
            summary: 'Mtg',
            start: { dateTime: '2026-05-20T09:00:00Z' },
            end: { dateTime: '2026-05-20T10:00:00Z' },
          },
          {
            id: 'B',
            start: { dateTime: '2026-05-20T12:00:00Z' },
            end: { dateTime: '2026-05-20T13:00:00Z' },
          },
        ],
      }),
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervals).toHaveLength(2)
      expect(r.intervals[0].externalEventId).toBe('A')
    }
  })

  it('paginates until nextPageToken is absent', async () => {
    let call = 0
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      call++
      // First call no pageToken in URL, second call includes it.
      const u = String(url)
      if (call === 1) {
        expect(u).not.toContain('pageToken=')
        return mockJsonResponse({
          items: [
            {
              id: 'X1',
              start: { dateTime: '2026-05-20T09:00:00Z' },
              end: { dateTime: '2026-05-20T10:00:00Z' },
            },
          ],
          nextPageToken: 'TOK2',
        })
      }
      expect(u).toContain('pageToken=TOK2')
      return mockJsonResponse({
        items: [
          {
            id: 'X2',
            start: { dateTime: '2026-05-21T09:00:00Z' },
            end: { dateTime: '2026-05-21T10:00:00Z' },
          },
        ],
      })
    }) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervals).toHaveLength(2)
      expect(r.intervals.map((i) => i.externalEventId)).toEqual(['X1', 'X2'])
    }
  })

  it('returns http error on non-2xx', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => 'unauthorized',
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') {
      expect(r.error.status).toBe(401)
      expect(r.error.body).toContain('unauthorized')
    }
  })

  it('returns shape error when response items is missing', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({}))
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'shape') {
      expect(r.error.message).toMatch(/items/)
    }
  })

  it('refuses to paginate past maxPages (loop defense)', async () => {
    // Every page returns nextPageToken — the call would loop forever
    // without the cap.
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [
          {
            id: 'L',
            start: { dateTime: '2026-05-20T09:00:00Z' },
            end: { dateTime: '2026-05-20T10:00:00Z' },
          },
        ],
        nextPageToken: 'NEXT',
      }),
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
      maxPages: 3,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'shape') {
      expect(r.error.message).toMatch(/paginated past/)
    }
  })

  it('returns network error on fetch throw', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ETIMEDOUT')
    }) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'network') {
      expect(r.error.message).toMatch(/ETIMEDOUT/)
    }
  })
})

// BCS-DEF-7 Phase 2 (2026-05-19) — delta-mode unit coverage.
//
// Hermetic: every test mocks `fetch`. Covers:
//   - happy path: parsed intervals + cancelled tombstones + token capture
//   - 410 Gone → sync_token_expired variant
//   - 400 Invalid sync token → sync_token_expired variant
//   - non-delta 400 / 410 → preserved http variant (no false sync-token signal)
//   - multi-page delta: nextSyncToken captured ONLY from final page
//   - mid-page nextSyncToken ignored (Google-bug defense)
//   - syncToken + timeMin/timeMax → shape error (mutually exclusive)
//   - showDeleted=true is set in delta mode (URL inspection)
//   - full-rewrite captures nextSyncToken when Google returns one (seeds delta track)
describe('pullBusyIntervalsForCalendar — delta mode', () => {
  it('happy path: parses 1 new + 1 cancelled + captures nextSyncToken', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      expect(u).toContain('syncToken=PREV_TOKEN')
      expect(u).toContain('showDeleted=true')
      expect(u).not.toContain('timeMin=')
      return mockJsonResponse({
        items: [
          {
            id: 'NEW_EVT',
            summary: 'New Meeting',
            start: { dateTime: '2026-05-21T09:00:00Z' },
            end: { dateTime: '2026-05-21T10:00:00Z' },
          },
          {
            id: 'CANCELLED_EVT',
            status: 'cancelled',
          },
        ],
        nextSyncToken: 'FRESH_TOKEN',
      })
    }) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'PREV_TOKEN',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intervals).toHaveLength(1)
      expect(r.intervals[0].externalEventId).toBe('NEW_EVT')
      expect(r.cancelledEventIds).toEqual(['CANCELLED_EVT'])
      expect(r.nextSyncToken).toBe('FRESH_TOKEN')
    }
  })

  it('returns sync_token_expired on HTTP 410', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 410,
          json: async () => ({}),
          text: async () =>
            JSON.stringify({ error: { message: 'Sync token is no longer valid' } }),
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'OLD_TOKEN',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('sync_token_expired')
  })

  it('returns sync_token_expired on 400 with "Invalid sync token" body', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () =>
            JSON.stringify({ error: { message: 'Invalid sync token value' } }),
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'OLD_TOKEN',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('sync_token_expired')
  })

  it('does NOT translate non-delta 400 / 410 into sync_token_expired (full-rewrite preserved)', async () => {
    const fetchMock410 = vi.fn(
      async () =>
        ({
          ok: false,
          status: 410,
          json: async () => ({}),
          text: async () => 'gone',
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const r410 = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      // no syncToken — this is full-rewrite mode
      fetchImpl: fetchMock410,
    })
    expect(r410.ok).toBe(false)
    if (!r410.ok && r410.error.kind === 'http') {
      expect(r410.error.status).toBe(410)
    } else {
      expect.fail('expected http error variant in full-rewrite mode')
    }
  })

  it('multi-page delta: nextSyncToken captured ONLY from final page (mid-page values ignored)', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) {
        return mockJsonResponse({
          items: [
            {
              id: 'P1_EVT',
              start: { dateTime: '2026-05-21T09:00:00Z' },
              end: { dateTime: '2026-05-21T10:00:00Z' },
            },
          ],
          nextPageToken: 'PAGE2',
          // Google bug defense: even if nextSyncToken arrives mid-pagination
          // (which it should NEVER do per their docs), we must IGNORE it
          // and only trust the token from the final page.
          nextSyncToken: 'WRONG_MID_TOKEN',
        })
      }
      return mockJsonResponse({
        items: [
          {
            id: 'P2_EVT',
            start: { dateTime: '2026-05-21T11:00:00Z' },
            end: { dateTime: '2026-05-21T12:00:00Z' },
          },
        ],
        nextSyncToken: 'CORRECT_FINAL_TOKEN',
      })
    }) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'START',
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.nextSyncToken).toBe('CORRECT_FINAL_TOKEN')
      expect(r.intervals.map((i) => i.externalEventId)).toEqual(['P1_EVT', 'P2_EVT'])
    }
  })

  it('returns shape error when syncToken + timeMin are both passed (Google rejects the combination)', async () => {
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'TOK',
      timeMin: new Date(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'shape') {
      expect(r.error.message).toMatch(/syncToken.*mutually exclusive/)
    }
  })

  it('full-rewrite mode also captures nextSyncToken when Google returns one (seeds delta track)', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [
          {
            id: 'X',
            start: { dateTime: '2026-05-21T09:00:00Z' },
            end: { dateTime: '2026-05-21T10:00:00Z' },
          },
        ],
        nextSyncToken: 'SEEDED_TOKEN',
      }),
    ) as unknown as typeof fetch
    const r = await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      // no syncToken — full-rewrite mode
      fetchImpl: fetchMock,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.nextSyncToken).toBe('SEEDED_TOKEN')
      expect(r.cancelledEventIds).toEqual([])
    }
  })

  it('delta-mode URL: showDeleted=true, no timeMin/timeMax, syncToken set', async () => {
    let capturedUrl = ''
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return mockJsonResponse({ items: [], nextSyncToken: 'T' })
    }) as unknown as typeof fetch
    await pullBusyIntervalsForCalendar({
      accessToken: 'AT',
      externalCalendarId: 'primary',
      syncToken: 'PREV',
      fetchImpl: fetchMock,
    })
    expect(capturedUrl).toContain('syncToken=PREV')
    expect(capturedUrl).toContain('showDeleted=true')
    expect(capturedUrl).not.toContain('timeMin=')
    expect(capturedUrl).not.toContain('timeMax=')
    expect(capturedUrl).not.toContain('singleEvents=')
  })
})

describe('listCalendars', () => {
  it('parses items with accessRole + derives isWritable', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [
          { id: 'primary', summary: 'Main', accessRole: 'owner', primary: true },
          { id: 'work@x', summary: 'Work', accessRole: 'writer' },
          { id: 'read@x', summary: 'Read-only', accessRole: 'reader' },
          { id: 'fbr@x', summary: 'Free-Busy', accessRole: 'freeBusyReader' },
        ],
      }),
    ) as unknown as typeof fetch
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: fetchMock })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calendars).toHaveLength(4)
      const primary = r.calendars.find((c) => c.id === 'primary')!
      expect(primary.isWritable).toBe(true)
      expect(primary.primary).toBe(true)
      expect(r.calendars.find((c) => c.id === 'work@x')!.isWritable).toBe(true)
      expect(r.calendars.find((c) => c.id === 'read@x')!.isWritable).toBe(false)
      expect(r.calendars.find((c) => c.id === 'fbr@x')!.isWritable).toBe(false)
    }
  })

  it('returns http error on non-2xx', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => 'forbidden',
        }) as unknown as Response,
    ) as unknown as typeof fetch
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: fetchMock })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'http') expect(r.error.status).toBe(403)
  })

  it('paginates calendarList via nextPageToken — Codex D.1 v2 review', async () => {
    let call = 0
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      call++
      const u = String(url)
      if (call === 1) {
        expect(u).not.toContain('pageToken=')
        return mockJsonResponse({
          items: [
            { id: 'primary', summary: 'P', accessRole: 'owner', primary: true },
            { id: 'cal2', summary: 'C2', accessRole: 'writer' },
          ],
          nextPageToken: 'PAGE2',
        })
      }
      expect(u).toContain('pageToken=PAGE2')
      return mockJsonResponse({
        items: [
          { id: 'cal3', summary: 'C3', accessRole: 'reader' },
          { id: 'cal4', summary: 'C4', accessRole: 'freeBusyReader' },
        ],
      })
    }) as unknown as typeof fetch
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: fetchMock })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calendars).toHaveLength(4)
      expect(r.calendars.map((c) => c.id)).toEqual([
        'primary',
        'cal2',
        'cal3',
        'cal4',
      ])
    }
  })

  it('calendarList refuses to paginate past maxPages (loop defense)', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse({
        items: [{ id: 'cal', summary: '', accessRole: 'owner' }],
        nextPageToken: 'NEVER_ENDS',
      }),
    ) as unknown as typeof fetch
    const r = await listCalendars({
      accessToken: 'AT',
      fetchImpl: fetchMock,
      maxPages: 3,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'shape') {
      expect(r.error.message).toMatch(/paginated past/)
    }
  })
})
