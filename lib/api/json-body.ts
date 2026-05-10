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

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export type JsonBodyOk = { ok: true; body: Record<string, unknown> }
export type JsonBodyFail = { ok: false; response: NextResponse }
export type JsonBodyResult = JsonBodyOk | JsonBodyFail

export async function readJsonObjectOr400(
  request: Request,
): Promise<JsonBodyResult> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Body must be a JSON object.' },
        { status: 400, headers: NO_STORE },
      ),
    }
  }
  return { ok: true, body: raw as Record<string, unknown> }
}
