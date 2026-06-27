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
// /admin*). This keeps the public promise "no third-party analytics in the
// cabinet" true and keeps Webvisor session-recording off forms that carry
// personal data. Input content is additionally masked via the Metrika
// dashboard setting ("не записывать содержимое полей") — owner-side. The two
// together (no-mount on private routes + input masking) are the defensible
// posture; the masking is the load-bearing protection for the rare
// client-side nav from a public page into a form.
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
  // Hard gate: no Metrika outside public marketing pages.
  if (!isPublicAnalyticsPath(pathname)) return null

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
