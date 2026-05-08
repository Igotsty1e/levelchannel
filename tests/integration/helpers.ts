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

// Wave A (calendar) — snap a future-N-minutes timestamp to the next
// 30-min boundary in MSK. After migration 0031, lesson_slots.start_at
// must satisfy `extract(minute) in (0, 30) AND extract(second) = 0`
// in MSK. Tests that previously used `new Date(Date.now() + N*60_000)`
// need this helper; the raw form will hit the new CHECK constraint.
//
// Note: UTC and MSK share minute-of-the-hour boundaries (MSK = UTC+3,
// integer-hour offset year-round, no DST since 2014), so snapping
// minutes in UTC is equivalent to snapping in MSK.
//
// PR3b CI fix — also clamps the resulting MSK wall hour into the
// business band [06:00..21:30 MSK] (last valid 30-min start before
// 22:00 cutoff). Migration 0031 rejects MSK hour > 22 OR (hour==22
// AND minute>0), so a naive +N-min stride that crosses 22:00 MSK
// in the test's time-of-day gives a 400 from the API which then
// breaks downstream `expect(409 not_open)` assertions. Clamp keeps
// the absolute time well-defined: if the snapped wall lands past
// 21:30 MSK, push it to 06:00 MSK the NEXT day. Test bodies don't
// care about the exact day — they just need a valid future slot.
export function futureSlotIso(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000)
  d.setUTCSeconds(0, 0)
  const minute = d.getUTCMinutes()
  if (minute === 0 || minute === 30) {
    // already aligned
  } else if (minute < 30) {
    d.setUTCMinutes(30, 0, 0)
  } else {
    d.setUTCMinutes(0, 0, 0)
    d.setUTCHours(d.getUTCHours() + 1)
  }
  // Clamp to MSK business band 06:00..21:30. Migration 0031 invariant:
  // mskHour in [6, 22] AND not (mskHour == 22 AND mskMinute > 0). The
  // last valid 30-min start cell is therefore 21:30 MSK (mskHour=21,
  // mskMinute=30). Push out-of-band moments to 06:00 MSK on the
  // next/current day.
  const mskParts = mskWallParts(d.getTime())
  const mskHour = mskParts.hour
  const mskMinute = mskParts.minute
  const violatesUpper =
    mskHour > 21 || (mskHour === 21 && mskMinute > 30)
  const violatesLower = mskHour < 6
  if (!violatesUpper && !violatesLower) {
    return d.toISOString()
  }
  // Snap to 06:00 MSK on the same day if we're below 06:00, else next
  // day if we're above 21:30. mskWallParts gives YMD; build the next
  // 06:00 MSK = 03:00 UTC instant from there.
  const nextDay = new Date(
    Date.UTC(
      mskParts.year,
      mskParts.month - 1,
      mskParts.day + (violatesUpper ? 1 : 0),
      3, // 06:00 MSK = 03:00 UTC
      0,
      0,
      0,
    ),
  )
  return nextDay.toISOString()
}

function mskWallParts(utcMs: number): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type === 'literal') continue
    map[p.type] = Number(p.value)
  }
  return {
    year: map.year ?? 0,
    month: map.month ?? 0,
    day: map.day ?? 0,
    hour: map.hour === 24 ? 0 : map.hour ?? 0,
    minute: map.minute ?? 0,
  }
}
