'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'

// Yandex.Metrika counter — installed 2026-06-16, enabled 2026-06-27.
// Counter ID 109816340. Settings: SSR, Webvisor, clickmap, e-commerce
// dataLayer, accurate bounce, link tracking.
//
// SCOPE (152-FZ, legal-rf SIGN-OFF 2026-06-27 — router→commercial→qa):
// Metrika — the counter AND Webvisor — loads ONLY on public marketing
// pages. It is NEVER mounted on authenticated / payment / PII surfaces
// (/login, /register, /auth*, /checkout*, /pay*, /cabinet*, /teacher*,
// /admin*). The cabinet is only ever entered via a full navigation (login
// POST → redirect), so on a /cabinet load this component returns null and no
// Metrika is present there — "no third-party analytics in the cabinet" holds.
//
// Known limitation (epic-end wave 2026-06-27): a client-side SPA nav from a
// public page to /login or /pay does NOT tear down an already-initialised
// `window.ym`/Webvisor recorder — `return null` only unmounts the <Script>
// element. The load-bearing protection for that path is INPUT MASKING (the
// Metrika dashboard "не записывать содержимое полей", owner-enabled): field
// contents are never captured. Public copy is worded accordingly — it claims
// masking, not absolute non-recording on those routes.
//
// Disclosure: app/privacy §7 + app/consent/personal-data §5
// (personal_data v2 / PERSONAL_DATA_DOCUMENT_VERSION 2026-06-27.1,
// migration 0142). docs/analytics/privacy.md carries the legal rationale.
//
// nonce: per-request CSP nonce, read in app/layout.tsx from the proxy.ts
// `x-nonce` header and passed down. next/script does NOT auto-stamp the
// nonce on a client-injected `afterInteractive` inline script, so we pass
// it explicitly — that is the fix for the CSP-block that kept the counter
// disabled before 2026-06-27.
//
// CSP allowances (lib/security/csp.ts): script-src / connect-src / img-src
// already include https://mc.yandex.ru.

export const YM_COUNTER_ID = 109816340

// Public marketing surfaces where web analytics is allowed. Everything not
// matched here gets NO Metrika at all.
const PUBLIC_ANALYTICS_PREFIXES = [
  '/saas/learn',
  '/saas/offer',
  '/offer',
  '/privacy',
  '/consent',
  '/integrations',
]

export function isPublicAnalyticsPath(pathname: string | null): boolean {
  if (!pathname) return false
  if (pathname === '/') return true
  return PUBLIC_ANALYTICS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

const INIT_SNIPPET = `
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for (var j = 0; j < document.scripts.length; j++) {
    if (document.scripts[j].src === r) { return; }
  }
  k=e.createElement(t); a=e.getElementsByTagName(t)[0];
  k.async=1; k.src=r; a.parentNode.insertBefore(k,a);
})(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=${YM_COUNTER_ID}', 'ym');

ym(${YM_COUNTER_ID}, 'init', {
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: "dataLayer",
  referrer: document.referrer,
  url: location.href,
  accurateTrackBounce: true,
  trackLinks: true
});
`.trim()

export function YandexMetrika({ nonce }: { nonce?: string }) {
  const pathname = usePathname()
  // Hard gate 1: no Metrika outside public marketing pages.
  if (!isPublicAnalyticsPath(pathname)) return null
  // Hard gate 2 (fail-closed): never emit the inline init script without the
  // per-request CSP nonce. On the proxy CSP-fallback path the nonce is absent;
  // skip analytics rather than ship an unnonced inline script.
  if (!nonce) return null

  return (
    <>
      <Script id="ym-init" nonce={nonce} strategy="afterInteractive">
        {INIT_SNIPPET}
      </Script>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${YM_COUNTER_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  )
}
