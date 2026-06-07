// Tiny helper to read a single cookie from a Request's `Cookie` header.
// Centralised to avoid drift across N route handlers that previously
// duplicated the same parser inline.

export function readCookieFromHeader(
  cookieHeader: string,
  name: string,
): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const p of parts) {
    const [k, v] = p.trim().split('=')
    if (k === name) return v ?? null
  }
  return null
}

export function readSessionCookie(
  request: Request,
  name: string,
): string | null {
  const header = request.headers.get('cookie') ?? ''
  return readCookieFromHeader(header, name)
}
