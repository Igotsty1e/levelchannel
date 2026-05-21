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

      // /setup endpoint — returns the operator setup script verbatim
      // as text/plain. Lets the operator run a SHORT curl|bash command
      // from the timeweb web-console without dealing with multi-line
      // copy-paste corruption of long raw-githubusercontent URLs.
      // Script source: scripts/setup-tg-webhook.sh in the repo (kept
      // in sync with the inline string below by code review).
      if (inUrl.pathname === '/setup' || inUrl.pathname === '/setup/') {
        return new Response(SETUP_SCRIPT, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
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

// Operator setup script — served at /setup. Kept in sync with
// scripts/setup-tg-webhook.sh manually; if you edit the .sh, mirror
// the change here. Backticks are escaped via `\``.
const SETUP_SCRIPT = [
  '#!/bin/bash',
  'set -e',
  'ENV_FILE="${ENV_FILE:?ENV_FILE not set — invoke as: ENV_FILE=/path curl -s URL | bash}"',
  'if [ ! -f "$ENV_FILE" ]; then echo "ERR: $ENV_FILE not found" >&2; exit 2; fi',
  'set -a; . "$ENV_FILE"; set +a',
  ': "${TELEGRAM_API_BASE_URL:?missing in env}"',
  ': "${TELEGRAM_BOT_TOKEN:?missing in env}"',
  ': "${TELEGRAM_WEBHOOK_SECRET_TOKEN:?missing in env}"',
  'BASE="${TELEGRAM_API_BASE_URL%/}"',
  'WEBHOOK_URL="${WEBHOOK_URL:-${BASE}/tg-in}"',
  'echo "Registering webhook → $WEBHOOK_URL"',
  'curl -s -X POST "$BASE/bot$TELEGRAM_BOT_TOKEN/setWebhook" \\',
  '  -d "url=$WEBHOOK_URL" \\',
  '  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN" \\',
  '  -d \'allowed_updates=["message"]\'',
  'echo ""',
  '',
].join('\n')

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
