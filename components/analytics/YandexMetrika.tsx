import Script from 'next/script'

// Yandex.Metrika counter — installed 2026-06-16.
// Counter ID 109816340. Settings enabled: SSR, Webvisor, clickmap,
// e-commerce dataLayer, accurate bounce, link tracking.
//
// Loaded via next/script with `afterInteractive` strategy so it does
// not block first paint. Next.js auto-stamps the per-request CSP
// nonce on this inline script (proxy.ts threads `x-nonce` into the
// dynamic render path → see app/layout.tsx for the nonce read).
//
// CSP allowances (lib/security/csp.ts + public/.htaccess):
//   script-src  + https://mc.yandex.ru
//   connect-src + https://mc.yandex.ru
//   img-src     + https://mc.yandex.ru
//
// noscript fallback is a 1×1 transparent <img> that pings the
// counter's /watch/ endpoint for users with JS disabled.

export const YM_COUNTER_ID = 109816340

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

export function YandexMetrika() {
  return (
    <>
      <Script id="ym-init" strategy="afterInteractive">
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
