// Wave 57 — shared HTTP response-header constants. Centralizing
// `NO_STORE` removes a ~45-site duplication of
// `const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }`
// across `app/api/**/route.ts` and a handful of `lib/` helpers.
//
// Why a constant and not just a string: every NextResponse caller
// passes this as the `headers` field on a response init object, so the
// constant being the object shape (not just the string value) avoids
// repeating the `'Cache-Control': ...` key at every call site.
//
// Why not `as const`: `NextResponse.json` happily accepts a plain
// Record<string, string> for `headers`, and TypeScript widens this
// shape just fine through Headers/HeadersInit overloads — no need
// for a readonly assertion to satisfy the types.

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Streaming responses (SSE) need `no-transform` to keep intermediary
// proxies from buffering or rewriting the event stream — a stricter
// variant of NO_STORE. Only used by the SSE endpoint today.
export const NO_STORE_STREAM = { 'Cache-Control': 'no-store, no-transform' }
