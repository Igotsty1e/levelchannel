// HTML attribute / body escape for inline templates. Today the only
// dynamic value is a verify/reset URL built from a validated origin and
// a base64url token (no `<>"'&` characters), so the templates are
// already safe by construction. The escape is here so that a future
// change to the URL or token format cannot silently introduce attribute
// injection or phishing markup. Defense in depth.

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] || char)
}
