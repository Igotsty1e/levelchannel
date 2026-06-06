// landing-v2 analytics events typed schema.
// Per plan §6 (round-2 BLOCKER #2 closure trim: NO register_started/completed
// — those require producers in app/register/page.tsx + app/api/auth/register/route.ts
// that this epic does NOT spec).

export type LandingVariantId = 'v2-a' | 'v2-b' | 'v2-c' | 'legacy'

export type LandingSectionId =
  | 'hero'
  | 'act_1_chaos'
  | 'act_2_pain'
  | 'act_3_broken'
  | 'act_4_product'
  | 'act_5_cta'
  | 'editorial_1'
  | 'editorial_2'
  | 'editorial_3'
  | 'demo_dashboard'
  | 'demo_try_action'
  | 'demo_save_cta'
  | 'footer'

export type LandingCtaId =
  | 'register_primary'
  | 'pricing_modal_open'
  | 'pricing_modal_close'
  | 'footer_link'
  | 'demo_save'

export type LandingConversionStep =
  | 'landing_view'
  | 'scroll_25'
  | 'scroll_50'
  | 'scroll_75'
  | 'scroll_100'
  | 'cta_click'

export type LandingEventPayload = {
  variantId: LandingVariantId
  sessionId: string
  viewportW?: number
  viewportH?: number
  refHost?: string
  scrollDepthPct?: number
  sectionSeen?: LandingSectionId
  ctaClicked?: LandingCtaId
  conversionStep?: LandingConversionStep
}

// Cookie-less session id: SHA-256(IP + UA + UTC date) — truncated client-side
// using a stable hash of UA + day bucket. Server augments with IP-derived
// component in the route handler (lib/security/request → enforceTrustedBrowserOrigin
// gives us a verified Origin; IP from getClientIp).

export function buildClientSessionId(): string {
  if (typeof window === 'undefined') return 'ssr'
  const ua = navigator.userAgent || 'no-ua'
  const day = new Date().toISOString().slice(0, 10)
  // Lightweight non-cryptographic hash (server hashes the canonical form).
  let h = 0
  const input = `${ua}|${day}`
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return `c${Math.abs(h).toString(36)}`
}

export function recordLandingEvent(payload: LandingEventPayload): void {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify(payload)
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon('/api/landing/event', new Blob([body], { type: 'application/json' }))
      if (ok) return
    }
    void fetch('/api/landing/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // Telemetry never throws to the page.
  }
}
