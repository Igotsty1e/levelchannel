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
export function futureSlotIso(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000)
  d.setUTCSeconds(0, 0)
  const minute = d.getUTCMinutes()
  if (minute === 0 || minute === 30) {
    return d.toISOString()
  }
  if (minute < 30) {
    d.setUTCMinutes(30, 0, 0)
  } else {
    d.setUTCMinutes(0, 0, 0)
    d.setUTCHours(d.getUTCHours() + 1)
  }
  return d.toISOString()
}
