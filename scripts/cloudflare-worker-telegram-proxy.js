// BCS-DEF-4-TG-PROXY (2026-05-21) — Cloudflare Worker bi-directional
// proxy for the Telegram bot pipeline.
//
// Outbound path: VPS → Worker → api.telegram.org
//   Used by scripts/lib/telegram-alerts.mjs (TELEGRAM_API_BASE_URL env).
//   Required because Timeweb VPS (RU hosting) cannot connect to
//   api.telegram.org directly (Roskomnadzor block).
//   Path: /bot<TOKEN>/<method>  (verbatim forward of any sub-path)
//
// Inbound path: Telegram → Worker → levelchannel.ru/api/telegram/webhook
//   Used because Telegram's webhook POSTs to 83.217.202.136 also time
//   out (same RKN block in the reverse direction). setWebhook URL now
//   points at this Worker; Worker forwards the POST + secret-token
//   header verbatim to the app. Cloudflare ↔ Timeweb is not blocked.
//   Path: /tg-in
//
// Plan / runbook: docs/private/OPERATIONS.private.md §12.5.e.

const INBOUND_TARGET = 'https://levelchannel.ru/api/telegram/webhook'

export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    try {
      const inUrl = new URL(request.url)

      // Inbound webhook forwarding — Telegram POSTs here, we forward
      // to the LevelChannel Next.js app. Preserve the secret-token
      // header so the app's webhook auth check passes.
      if (inUrl.pathname === '/tg-in' || inUrl.pathname === '/tg-in/') {
        return await forwardInbound(request)
      }

      // Reject empty-path probes — workers.dev gets a lot of random
      // crawler traffic; bouncing them with 404 keeps logs clean.
      if (inUrl.pathname === '/' || inUrl.pathname === '') {
        return new Response(
          'LevelChannel Telegram proxy. /bot<TOKEN>/<method> (outbound) or /tg-in (inbound).',
          {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          },
        )
      }

      // Outbound forwarding — any path starting with /bot or other
      // Telegram API surface forwards to api.telegram.org.
      return await forwardOutbound(request, inUrl)
    } catch (err) {
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

async function forwardOutbound(request, inUrl) {
  const targetUrl = new URL(
    inUrl.pathname + inUrl.search,
    'https://api.telegram.org',
  )

  const fwdHeaders = new Headers(request.headers)
  for (const k of [...fwdHeaders.keys()]) {
    if (
      k.startsWith('cf-')
      || k.startsWith('x-forwarded-')
      || k === 'x-real-ip'
      || k === 'host'
    ) {
      fwdHeaders.delete(k)
    }
  }

  const fwd = new Request(targetUrl.toString(), {
    method: request.method,
    headers: fwdHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    // @ts-ignore — Cloudflare extension
    duplex: 'half',
    redirect: 'follow',
  })

  const upstream = await fetch(fwd)
  const respHeaders = new Headers(upstream.headers)
  respHeaders.set('cache-control', 'no-store')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}

async function forwardInbound(request) {
  // Only POST is meaningful for Telegram webhook callbacks.
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 405,
        description: 'method_not_allowed: only POST is forwarded',
      }),
      {
        status: 405,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  // Forward headers verbatim including X-Telegram-Bot-Api-Secret-Token.
  // The app validates the secret on its end; we do NOT validate at
  // the Worker layer (secret would have to be stored in worker code,
  // which is harder to rotate than an env var on the VPS).
  const fwdHeaders = new Headers(request.headers)
  for (const k of [...fwdHeaders.keys()]) {
    if (
      k.startsWith('cf-')
      || k.startsWith('x-forwarded-')
      || k === 'x-real-ip'
      || k === 'host'
    ) {
      fwdHeaders.delete(k)
    }
  }

  const fwd = new Request(INBOUND_TARGET, {
    method: 'POST',
    headers: fwdHeaders,
    body: request.body,
    // @ts-ignore — Cloudflare extension
    duplex: 'half',
    redirect: 'follow',
  })

  const upstream = await fetch(fwd)
  const respHeaders = new Headers(upstream.headers)
  respHeaders.set('cache-control', 'no-store')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}
