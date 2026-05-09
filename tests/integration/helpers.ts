// Helpers to invoke route handlers directly as functions. Avoids spinning
// up a Next dev server. Side effects hit DATABASE_URL (Docker Postgres
// brought up by scripts/test-integration.sh).

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  searchParams?: Record<string, string>
  cookie?: string
}

export function buildRequest(path: string, opts: RequestOptions = {}): Request {
  const url = new URL(path, SITE_URL)
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': SITE_URL,
    'Sec-Fetch-Site': 'same-origin',
    ...(opts.headers || {}),
  }
  if (opts.cookie) {
    headers['cookie'] = opts.cookie
  }

  return new Request(url.toString(), {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

// Pull `lc_session=<value>` out of a Set-Cookie header for chained requests.
export function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null
  const match = /lc_session=([^;]+)/.exec(setCookie)
  return match ? `lc_session=${match[1]}` : null
}

// Test helper — deterministic future business-band slot.
//
// Migration 0031 enforces start_at in [06:00..22:00 MSK] on a 30-min
// boundary. Earlier helper iterations were time-of-day-flaky: the
// previous "now + N min, snap, clamp to next-day-06:00 if out of
// band" had two issues:
//   1. multiple tests with different N values all clamped to the
//      same 06:00 anchor when the time-of-day pushed them past
//      22:00 — colliding (teacher, start_at) constraint violations
//      → 23505 → 409 → flaky test failures.
//   2. ordering of `a < b` was not preserved across the clamp.
//
// New approach: map `minutesFromNow` deterministically into a unique
// 30-min cell in the business band. Anchor = today's MSK midnight
// + 7 days + 06:00. From that anchor we lay out 33 slots/day × 7
// days = 231 slots/week. Input N is converted to a slot index
// `floor(N/30)`, then wrapped to fit the 7-day window. Each unique
// N → unique cell as long as `N/30` differs modulo 231; in practice
// tests use N values that map uniquely.
//
// The result is INDEPENDENT of when the test runs (anchored on
// today's MSK date, but tests truncate tables in afterEach so
// across-test state doesn't matter). It is in the business band by
// construction. It is 30-min aligned by construction. It is unique
// per distinct N (modulo 231).

const MSK_OFFSET_HOURS = 3 // year-round, no DST
const ANCHOR_DAYS_FORWARD = 7 // start tests next week
const SLOTS_PER_DAY = 33 // 06:00, 06:30, ..., 22:00 inclusive
const SLOTS_PER_WEEK = SLOTS_PER_DAY * 7 // 231

export function futureSlotIso(minutesFromNow: number): string {
  // Slot index from N. floor(/30) so N=60 and N=90 produce different
  // indices. Wrap to a 7-day window so giant N values (e.g.
  // 7*24*60+240 in many existing tests) still land in the window.
  const slotIdx = Math.floor(minutesFromNow / 30)
  const wrappedIdx = ((slotIdx % SLOTS_PER_WEEK) + SLOTS_PER_WEEK) % SLOTS_PER_WEEK
  const dayOffset = Math.floor(wrappedIdx / SLOTS_PER_DAY)
  const slotInDay = wrappedIdx % SLOTS_PER_DAY
  const totalMinFromBandStart = slotInDay * 30
  const targetMskHour = 6 + Math.floor(totalMinFromBandStart / 60)
  const targetMskMinute = totalMinFromBandStart % 60

  // Anchor: today's MSK date + ANCHOR_DAYS_FORWARD + dayOffset, at
  // targetMskHour:targetMskMinute MSK = (hour - 3) UTC.
  const todayMsk = mskTodayParts()
  const targetUtc = new Date(
    Date.UTC(
      todayMsk.year,
      todayMsk.month - 1,
      todayMsk.day + ANCHOR_DAYS_FORWARD + dayOffset,
      targetMskHour - MSK_OFFSET_HOURS,
      targetMskMinute,
      0,
      0,
    ),
  )
  return targetUtc.toISOString()
}

// Pick a near-future MSK 30-min slot that's strictly within the
// business band 06:00–22:00 MSK and < 24h from now. Used by tests
// that need to backdate a booked slot into the 24h-rule window
// (e.g. lifecycle.test.ts) without violating migration 0031's
// CHECK constraints. Picks the first valid slot after now+30min.
export function nearFutureBusinessBandIso(): string {
  const now = new Date()
  let candidate = new Date(now.getTime() + 30 * 60_000)
  candidate.setUTCSeconds(0, 0)
  const minute = candidate.getUTCMinutes()
  if (minute === 0 || minute === 30) {
    // already aligned
  } else if (minute < 30) {
    candidate.setUTCMinutes(30, 0, 0)
  } else {
    candidate.setUTCMinutes(0, 0, 0)
    candidate.setUTCHours(candidate.getUTCHours() + 1)
  }
  // Check MSK band; if out of band, push to the next opening
  // (next-day 06:00 MSK = 03:00 UTC). We always end up < 24h from
  // now because the latest possible push is "now is between 22:00
  // MSK and midnight, so next-day 06:00 is at most ~7h away".
  const mskParts = mskWallParts(candidate.getTime())
  const inBand =
    mskParts.hour >= 6 && (mskParts.hour < 22 || (mskParts.hour === 22 && mskParts.minute === 0))
  if (inBand) return candidate.toISOString()
  const day = mskTodayParts()
  // Tomorrow 06:00 MSK = same date + 1 day, hour=6 MSK = 3 UTC.
  const tomorrowSixMsk = new Date(
    Date.UTC(day.year, day.month - 1, day.day + 1, 3, 0, 0, 0),
  )
  return tomorrowSixMsk.toISOString()
}

function mskWallParts(utcMs: number): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  return {
    hour: map.hour === 24 ? 0 : map.hour ?? 0,
    minute: map.minute ?? 0,
  }
}

function mskTodayParts(): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(new Date())
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  return {
    year: map.year ?? 0,
    month: map.month ?? 0,
    day: map.day ?? 0,
  }
}
