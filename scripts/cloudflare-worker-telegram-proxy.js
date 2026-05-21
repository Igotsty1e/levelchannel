// BCS-DEF-4-TG-PROXY (2026-05-21) — Cloudflare Worker reverse proxy
// for api.telegram.org. Required because Timeweb VPS (RU hosting)
// cannot connect to api.telegram.org directly (Roskomnadzor block).
//
// Plan / runbook: docs/private/OPERATIONS.private.md §12.5.e
// (Cloudflare Worker setup).
//
// Behaviour:
//   - Accept any request to https://<worker-subdomain>.workers.dev/<path>
//   - Forward verbatim to https://api.telegram.org/<path>
//   - Preserve method, query string, headers, body
//   - Stream the response body back to the caller
//
// Auth: NONE at the proxy layer. Authorisation is in the URL itself
// (`/bot<TOKEN>/<method>` — the bot token IS the credential). Adding
// proxy-level auth would also block Telegram's webhook-callback path
// (Telegram calls our /api/telegram/webhook directly, NOT through
// this proxy — so this proxy is outbound-only).
//
// Threat model:
//   - An attacker who learns the worker URL still needs a valid bot
//     token to do anything (Telegram returns 401 without one).
//   - Worker URL itself is not a secret; it's a public DNS name.
//   - The bot token is sent over TLS to Cloudflare, terminated at
//     Cloudflare's edge, then re-encrypted on the leg to
//     api.telegram.org. Same trust posture as using Cloudflare as a
//     CDN — acceptable for our threat model.
//
// Cost: Workers free tier is 100k requests / day. Our peak is bounded
// by 4 probes × 1-2 reminders/min + ~teacher daily digest + ~learner
// reminders — well under 1k requests / day even at peak.

export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    try {
      const inUrl = new URL(request.url)
      const targetUrl = new URL(inUrl.pathname + inUrl.search, 'https://api.telegram.org')

      // Reject empty-path probes — workers.dev gets a lot of random
      // crawler traffic; bouncing them with 404 keeps logs clean.
      if (inUrl.pathname === '/' || inUrl.pathname === '') {
        return new Response('LevelChannel Telegram proxy. Hit /bot<TOKEN>/<method>.', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }

      // Build forwarded request. Strip `host` (Cloudflare sets it for us)
      // and `cf-*` / `x-real-ip` / `x-forwarded-*` headers (Telegram
      // doesn't care + leaking them downgrades caller anonymity).
      const fwdHeaders = new Headers(request.headers)
      for (const k of [...fwdHeaders.keys()]) {
        if (k.startsWith('cf-') || k.startsWith('x-forwarded-') || k === 'x-real-ip' || k === 'host') {
          fwdHeaders.delete(k)
        }
      }

      const fwd = new Request(targetUrl.toString(), {
        method: request.method,
        headers: fwdHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        // Cloudflare Workers do not support streaming request bodies
        // through `body: ReadableStream` for some HTTP/2 cases — use
        // duplex 'half' so the body is sent in one shot.
        // @ts-ignore — Cloudflare extension
        duplex: 'half',
        redirect: 'follow',
      })

      const upstream = await fetch(fwd)

      // Surface upstream status + headers + body verbatim. We DO NOT
      // mutate the body; Telegram's response shape is what the caller
      // expects.
      const respHeaders = new Headers(upstream.headers)
      // Cloudflare may attempt to cache 200 responses — explicitly
      // disable to avoid cross-token replay.
      respHeaders.set('cache-control', 'no-store')

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      })
    } catch (err) {
      // Treat any worker-level error as 502. Caller (telegram-alerts.mjs)
      // already retries on 5xx.
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 502,
          description: `proxy_error: ${err instanceof Error ? err.message : String(err)}`,
        }),
        {
          status: 502,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
  },
}
