import { NextResponse } from 'next/server'

// Wave 16 — DRY helper for the JSON-parse + "must be an object"
// gate that ~20 routes hand-roll. Every caller used to write:
//
//   let body: unknown
//   try { body = await request.json() } catch { return NextResponse.json(
//     { error: 'Invalid JSON body.' }, { status: 400, headers: NO_STORE })
//   }
//   if (typeof body !== 'object' || body === null) {
//     return NextResponse.json(
//       { error: 'Body must be a JSON object.' }, { status: 400, headers: NO_STORE })
//   }
//
// Now: `const r = await readJsonObjectOr400(request); if (!r.ok) return r.response`.
//
// Why ok/response shape (vs throw): keeps the route handler's
// happy-path linear and lets the caller branch with one early return
// — no try/catch noise, no NextResponse import in routes that don't
// otherwise need it.
//
// Wave 56 — optional `coded` mode for routes that follow the Wave
// 33-36 error-code contract: `{ error: 'invalid_json_body', message: '…' }`
// + `{ error: 'body_must_be_object', message: '…' }`. The default
// stays on the legacy `{ error: '<human string>' }` shape so existing
// callers don't move.

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export type JsonBodyOk = { ok: true; body: Record<string, unknown> }
export type JsonBodyFail = { ok: false; response: NextResponse }
export type JsonBodyResult = JsonBodyOk | JsonBodyFail

export type ReadJsonOptions = {
  // When true, emit the Wave 33-36 contract: a stable `error` code
  // string plus a human `message`. When false/omitted, emit the
  // legacy `{ error: '<human string>' }` shape.
  coded?: boolean
}

export async function readJsonObjectOr400(
  request: Request,
  opts?: ReadJsonOptions,
): Promise<JsonBodyResult> {
  const coded = opts?.coded === true
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        coded
          ? { error: 'invalid_json_body', message: 'Invalid JSON body.' }
          : { error: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        coded
          ? { error: 'body_must_be_object', message: 'Body must be a JSON object.' }
          : { error: 'Body must be a JSON object.' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  return { ok: true, body: raw as Record<string, unknown> }
}
