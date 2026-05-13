// BCS-E.1 — Google Calendar push primitives. events.insert / patch /
// delete with deterministic event id + F8 ownership stamp.
//
// Plan §4.5 + Codex r2 finding closed:
//   - `events.insert` is NOT idempotent on retry by default — a
//     timeout / ambiguous 5xx would create a duplicate event. Fix:
//     supply a CLIENT-CHOSEN `event.id` derived deterministically
//     from `slot.id`. On 409 (id already used in this calendar) →
//     call `events.get` to bind, confirm ownership via
//     `extendedProperties.shared.lc_slot_id === slot.id`.
//   - `extendedProperties.shared.{lc_origin,lc_slot_id,lc_epoch}` is
//     LC's identity stamp on every pushed event. Cross-calendar
//     `shared` propagation lets the pull-side detect "our own echo"
//     reliably (vs `private`, which is per-copy). Plan F8.
//   - `lc_epoch` is rotated on disconnect/reconnect so stale events
//     from a prior integration session surface as `is_orphan_self`.
//
// Reference:
//   https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
//   https://developers.google.com/workspace/calendar/api/guides/extended-properties

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

// Google requires event id to be 5-1024 chars, base32hex alphabet
// (0-9a-v), and must START WITH A LETTER. We use base32 of the
// slot UUID + `lc-` prefix → fits cleanly.
//
// Codex r2 reference:
//   https://developers.google.com/workspace/calendar/api/v3/reference/events
const EVENT_ID_PREFIX = 'lc'
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

function uuidToBase32(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('deterministicEventId: invalid UUID input')
  }
  // 128-bit UUID → 32 hex chars → 16 bytes → 26 base32 chars (padless).
  // We don't need a strict base32 of the bytes; just need a stable,
  // deterministic, lowercase-alphabetic string. We map each hex nibble
  // pair to two base32 chars: each nibble takes 4 bits, pair = 8 bits =
  // 1 byte. To stay within Google's accepted alphabet (no '0'/'1' that
  // might be confused), use straight base32 on the 16 raw bytes.
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  // RFC 4648 base32 (without padding) on 16 bytes → 26 chars.
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32[(value >>> bits) & 0x1f]
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 0x1f]
  }
  return out
}

export function deterministicEventId(slotId: string): string {
  return `${EVENT_ID_PREFIX}${uuidToBase32(slotId)}`
}

export type LcOwnershipStamp = {
  lcOrigin: 'levelchannel'
  lcSlotId: string
  lcEpoch: string
}

export type PushEventInput = {
  startAt: string // ISO UTC
  endAt: string // ISO UTC
  summary: string
  description?: string
  // Plan §4.5: stamp lc_* shared + private (defense-in-depth).
  ownership: LcOwnershipStamp
}

export type GoogleEventResource = {
  id: string
  etag: string
  iCalUID?: string
  extendedProperties?: {
    shared?: Record<string, string>
    private?: Record<string, string>
  }
}

export type PushOutcome =
  | { ok: true; event: GoogleEventResource; reused: boolean }
  | { ok: false; error: PushError }

export type DeleteOutcome =
  | { ok: true; status: number }
  | { ok: false; error: PushError }

export type PushError =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'shape'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'ownership_mismatch'; eventId: string; foreignSlotId?: string }

function buildBody(opts: { slotId: string; input: PushEventInput }) {
  return {
    id: deterministicEventId(opts.slotId),
    summary: opts.input.summary,
    description: opts.input.description ?? undefined,
    start: { dateTime: opts.input.startAt },
    end: { dateTime: opts.input.endAt },
    extendedProperties: {
      shared: {
        lc_origin: opts.input.ownership.lcOrigin,
        lc_slot_id: opts.input.ownership.lcSlotId,
        lc_epoch: opts.input.ownership.lcEpoch,
      },
      private: {
        // Defense-in-depth: `private` is per-copy, but if cross-copy
        // mirroring strips `shared` for any reason, the reconciliation
        // sweep can still match the slot id locally.
        lc_slot_id: opts.input.ownership.lcSlotId,
      },
    },
  }
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// Inserts the event with a deterministic id. On 409 (conflict — id
// already used in this calendar), fetches the existing event via
// events.get, verifies ownership via shared.lc_slot_id, and returns
// it with `reused: true` so the worker can bind without creating a
// duplicate.
export async function insertEventIdempotent(opts: {
  accessToken: string
  externalCalendarId: string
  slotId: string
  input: PushEventInput
  fetchImpl?: typeof fetch
}): Promise<PushOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const eventId = deterministicEventId(opts.slotId)
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events`
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildBody({ slotId: opts.slotId, input: opts.input })),
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

  if (res.ok) {
    const event = await parseEventResponse(res)
    if ('error' in event) {
      return { ok: false, error: { kind: 'shape', message: event.error } }
    }
    return { ok: true, event, reused: false }
  }

  if (res.status === 409) {
    // Either a previous attempt created the event, or someone else
    // is using our id (cosmic-ray rare — our ids are UUID-base32).
    // events.get + ownership confirm.
    return getAndConfirmOwnership({
      accessToken: opts.accessToken,
      externalCalendarId: opts.externalCalendarId,
      eventId,
      expectedSlotId: opts.slotId,
      fetchImpl,
    })
  }

  return {
    ok: false,
    error: { kind: 'http', status: res.status, body: await readBody(res) },
  }
}

async function getAndConfirmOwnership(opts: {
  accessToken: string
  externalCalendarId: string
  eventId: string
  expectedSlotId: string
  fetchImpl: typeof fetch
}): Promise<PushOutcome> {
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events/${encodeURIComponent(opts.eventId)}`
  let res: Response
  try {
    res = await opts.fetchImpl(url, {
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
    return {
      ok: false,
      error: { kind: 'http', status: res.status, body: await readBody(res) },
    }
  }
  const event = await parseEventResponse(res)
  if ('error' in event) {
    return { ok: false, error: { kind: 'shape', message: event.error } }
  }
  const claimedSlot = event.extendedProperties?.shared?.lc_slot_id
    ?? event.extendedProperties?.private?.lc_slot_id
  if (claimedSlot !== opts.expectedSlotId) {
    return {
      ok: false,
      error: {
        kind: 'ownership_mismatch',
        eventId: event.id,
        foreignSlotId: claimedSlot,
      },
    }
  }
  return { ok: true, event, reused: true }
}

// Patches an existing event (rebooked time, updated summary, etc).
// The caller passes the current eventId (from prior insert binding).
// 404/410 → treat as terminal-success / cleared upstream — let the
// caller decide whether to recreate.
export async function patchEvent(opts: {
  accessToken: string
  externalCalendarId: string
  eventId: string
  input: Partial<PushEventInput> & { slotId?: string }
  fetchImpl?: typeof fetch
}): Promise<PushOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events/${encodeURIComponent(opts.eventId)}`
  const body: Record<string, unknown> = {}
  if (opts.input.summary !== undefined) body.summary = opts.input.summary
  if (opts.input.description !== undefined) body.description = opts.input.description
  if (opts.input.startAt) body.start = { dateTime: opts.input.startAt }
  if (opts.input.endAt) body.end = { dateTime: opts.input.endAt }
  if (opts.input.ownership) {
    body.extendedProperties = {
      shared: {
        lc_origin: opts.input.ownership.lcOrigin,
        lc_slot_id: opts.input.ownership.lcSlotId,
        lc_epoch: opts.input.ownership.lcEpoch,
      },
      private: {
        lc_slot_id: opts.input.ownership.lcSlotId,
      },
    }
  }
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
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
  if (res.ok) {
    const event = await parseEventResponse(res)
    if ('error' in event) {
      return { ok: false, error: { kind: 'shape', message: event.error } }
    }
    return { ok: true, event, reused: false }
  }
  return {
    ok: false,
    error: { kind: 'http', status: res.status, body: await readBody(res) },
  }
}

// Deletes the event. Plan §4.5: 200/204/404/410 are ALL terminal-
// success — the target is no longer present (whether we deleted it
// just now or someone else did earlier). Other 4xx → permanent
// failure. 5xx/429/network → transient (caller retries).
export async function deleteEvent(opts: {
  accessToken: string
  externalCalendarId: string
  eventId: string
  fetchImpl?: typeof fetch
}): Promise<DeleteOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events/${encodeURIComponent(opts.eventId)}`
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
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
  if (res.ok || res.status === 404 || res.status === 410) {
    return { ok: true, status: res.status }
  }
  return {
    ok: false,
    error: { kind: 'http', status: res.status, body: await readBody(res) },
  }
}

async function parseEventResponse(
  res: Response,
): Promise<GoogleEventResource | { error: string }> {
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (e) {
    return { error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'event response not an object' }
  }
  const r = parsed as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) {
    return { error: 'event response missing id' }
  }
  return {
    id: r.id,
    etag: typeof r.etag === 'string' ? r.etag : '',
    iCalUID: typeof r.iCalUID === 'string' ? r.iCalUID : undefined,
    extendedProperties:
      typeof r.extendedProperties === 'object' && r.extendedProperties !== null
        ? (r.extendedProperties as GoogleEventResource['extendedProperties'])
        : undefined,
  }
}
