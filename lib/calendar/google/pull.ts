// BCS-D.1 — Google Calendar pull primitives. Pure async HTTP wrappers
// over `events.list` and `calendarList.list`. No DB writes here; the
// worker in BCS-D.2 will consume these results and full-rewrite the
// `teacher_external_busy_intervals` table per (teacher, calendar) pair.
//
// Plan §4.4 contract:
//   - bounded window [now-1d, now+30d], `singleEvents=true,
//     showDeleted=false`
//   - NO syncToken (Google API forbids combining with time-window),
//     so each cycle is a full-rewrite. Real incremental sync deferred
//     to a separate wave.
//   - paginated via pageToken; pull keeps fetching until pageToken is
//     absent in the response.
//   - all-day events flagged via `start.date` (no `dateTime`).
//   - `extendedProperties.shared.lc_*` parsed so the worker can mark
//     `is_own_event` / `is_orphan_self` per the F8 epoch rule.
//
// All functions take a `fetchImpl` parameter so the worker can inject
// the real `fetch` and tests can pass a mock.

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

export type GoogleEventTimePart =
  | { dateTime: string; timeZone?: string }
  | { date: string } // all-day event

export type GoogleRawEvent = {
  id: string
  iCalUID?: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  start: GoogleEventTimePart
  end: GoogleEventTimePart
  etag?: string
  extendedProperties?: {
    shared?: Record<string, string>
    private?: Record<string, string>
  }
}

export type ParsedBusyInterval = {
  externalEventId: string
  externalCalendarId: string
  startAt: string // ISO UTC
  endAt: string // ISO UTC
  summary: string | null
  isAllDay: boolean
  etag: string | null
  // Plan F8 epoch-aware ownership stamp.
  lcOrigin: string | null
  lcSlotId: string | null
  lcEpoch: string | null
}

export type GoogleCalendarListEntry = {
  id: string
  summary: string
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | string
  primary: boolean
  // Derived: write access (owner|writer).
  isWritable: boolean
}

export type PullError =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'shape'; message: string }
  | { kind: 'network'; message: string }

const ALL_DAY_TZ_NOTE =
  'all-day event — interpreted as MSK day boundary per plan §4.4 (MSK-only teachers in MVP)'

// Parses a Google event time-part into a UTC ISO string. For all-day
// events (date only, no dateTime), we interpret the local date as
// Europe/Moscow midnight — that's the MSK-only-teachers contract from
// plan §8 #9. For dateTime values, Google sends them with a
// fully-qualified offset; we just round-trip through Date.
//
// Codex D.1 review: this must be a TOTAL function. A single bad event
// in a Google response (rare but possible — bad data in a third-party
// import, scenario testing) would otherwise raise RangeError from
// Date.toISOString and abort the entire pull cycle. Returns null on
// anything we can't parse cleanly; shapeEvent then drops the event.
function timePartToUtcIso(
  part: GoogleEventTimePart,
): { iso: string; isAllDay: boolean } | null {
  try {
    if ('dateTime' in part) {
      const ms = new Date(part.dateTime).getTime()
      if (!Number.isFinite(ms)) return null
      return { iso: new Date(ms).toISOString(), isAllDay: false }
    }
    // All-day: `date` is YYYY-MM-DD in the calendar's timezone. We
    // pin to MSK per the MVP guard.
    const ymd = part.date
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      const ms = new Date(`${ymd}T00:00:00+03:00`).getTime()
      if (!Number.isFinite(ms)) return null
      return { iso: new Date(ms).toISOString(), isAllDay: true }
    }
    const ms = new Date(ymd).getTime()
    if (!Number.isFinite(ms)) return null
    return { iso: new Date(ms).toISOString(), isAllDay: true }
  } catch {
    return null
  }
}

export function shapeEvent(
  raw: unknown,
  externalCalendarId: string,
): ParsedBusyInterval | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as GoogleRawEvent
  if (typeof r.id !== 'string' || !r.id) return null
  // Skip cancelled events — they're tombstones from showDeleted=true.
  // We fetch with showDeleted=false so this is defensive only.
  if (r.status === 'cancelled') return null
  if (typeof r.start !== 'object' || r.start === null) return null
  if (typeof r.end !== 'object' || r.end === null) return null
  const start = timePartToUtcIso(r.start)
  const end = timePartToUtcIso(r.end)
  if (!start || !end) return null
  // Zero-length and inverted intervals are rejected — DB CHECK
  // (`teacher_external_busy_intervals_range_check`) would refuse
  // them anyway. Best-effort drop at parse time so we don't blow up
  // the bulk insert.
  if (new Date(end.iso).getTime() <= new Date(start.iso).getTime()) return null

  const shared = r.extendedProperties?.shared
  return {
    externalEventId: r.id,
    externalCalendarId,
    startAt: start.iso,
    endAt: end.iso,
    summary: typeof r.summary === 'string' ? r.summary : null,
    isAllDay: start.isAllDay || end.isAllDay,
    etag: typeof r.etag === 'string' ? r.etag : null,
    lcOrigin: shared?.lc_origin ?? null,
    lcSlotId: shared?.lc_slot_id ?? null,
    lcEpoch: shared?.lc_epoch ?? null,
  }
}
// re-export note so external consumers can read the ALL_DAY_TZ_NOTE
// docs string in code reviews without rebuilding it.
export const PULL_DOC_NOTES = { ALL_DAY_TZ_NOTE }

// Pulls every event in [now-1d, now+30d] for ONE calendar belonging
// to the teacher whose accessToken we've been given. Caller is
// responsible for fetching fresh tokens (refresh flow) before this.
//
// Returns parsed busy intervals, paginated through all `pageToken`s
// transparently. Page-cap = 10 to bound rogue paginations (~10 x 250
// = 2500 events in the 31-day window — plenty for one teacher).
export async function pullBusyIntervalsForCalendar(opts: {
  accessToken: string
  externalCalendarId: string
  // Override for tests / window experiments. Defaults to [now-1d, now+30d].
  timeMin?: Date
  timeMax?: Date
  fetchImpl?: typeof fetch
  maxPages?: number
}): Promise<
  | { ok: true; intervals: ParsedBusyInterval[] }
  | { ok: false; error: PullError }
> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxPages = opts.maxPages ?? 10
  const now = Date.now()
  const timeMin = (opts.timeMin ?? new Date(now - 24 * 60 * 60_000)).toISOString()
  const timeMax = (opts.timeMax ?? new Date(now + 30 * 24 * 60 * 60_000)).toISOString()

  const intervals: ParsedBusyInterval[] = []
  let pageToken: string | undefined = undefined
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(
      `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events`,
    )
    url.searchParams.set('timeMin', timeMin)
    url.searchParams.set('timeMax', timeMax)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('showDeleted', 'false')
    url.searchParams.set('maxResults', '250')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    let res: Response
    try {
      res = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          Accept: 'application/json',
        },
      })
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: e instanceof Error ? e.message : String(e),
        },
      }
    }
    if (!res.ok) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        // ignore
      }
      return { ok: false, error: { kind: 'http', status: res.status, body } }
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: 'shape',
          message: `events.list JSON parse failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
      }
    }
    const data = parsed as {
      items?: unknown[]
      nextPageToken?: string
    }
    if (!Array.isArray(data.items)) {
      return { ok: false, error: { kind: 'shape', message: 'events.list response missing items' } }
    }
    for (const item of data.items) {
      const shaped = shapeEvent(item, opts.externalCalendarId)
      if (shaped) intervals.push(shaped)
    }
    if (!data.nextPageToken) {
      return { ok: true, intervals }
    }
    pageToken = data.nextPageToken
  }
  // We exited the loop without seeing nextPageToken = null. Either
  // the teacher has > maxPages worth of events (unrealistic for one
  // month at 250/page = 2500 events) or a Google bug. Treat as a
  // shape error so the worker surfaces it.
  return {
    ok: false,
    error: {
      kind: 'shape',
      message: `events.list paginated past ${maxPages} pages; possible loop`,
    },
  }
}

// Lists the teacher's calendars + accessRole. Used by:
//   - the settings UI to let the teacher pick which calendars to
//     read from and which one to write events into;
//   - the worker to compute `is_writable_in_source` per row when
//     storing busy intervals.
export async function listCalendars(opts: {
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<
  | { ok: true; calendars: GoogleCalendarListEntry[] }
  | { ok: false; error: PullError }
> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${GOOGLE_API_BASE}/users/me/calendarList`, {
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: 'application/json',
      },
    })
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'network',
        message: e instanceof Error ? e.message : String(e),
      },
    }
  }
  if (!res.ok) {
    let body = ''
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    return { ok: false, error: { kind: 'http', status: res.status, body } }
  }
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'shape',
        message: `calendarList.list JSON parse failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    }
  }
  const data = parsed as { items?: unknown[] }
  if (!Array.isArray(data.items)) {
    return {
      ok: false,
      error: { kind: 'shape', message: 'calendarList.list response missing items' },
    }
  }
  const calendars: GoogleCalendarListEntry[] = []
  for (const item of data.items) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) continue
    const accessRole = typeof r.accessRole === 'string' ? r.accessRole : ''
    calendars.push({
      id: r.id,
      summary: typeof r.summary === 'string' ? r.summary : '',
      accessRole,
      primary: r.primary === true,
      isWritable: accessRole === 'owner' || accessRole === 'writer',
    })
  }
  return { ok: true, calendars }
}
