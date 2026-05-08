'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

// Top-level React error boundary. Forwards to Sentry, then renders a
// minimal Russian-language fallback. Fires for errors that escape page-
// level error.tsx — rare, but the only place global render failures
// get a chance to be captured.
//
// Codex review 2026-05-09 — known gap: global-error renders WITHOUT
// the root layout. Per Next.js docs, this component MUST be a client
// component (`'use client'`), so it cannot read `headers()` to trigger
// the framework's nonce auto-stamp. Two consequences accepted:
//
//   1. Framework-emitted inline `<script>` blocks for hydration on
//      this surface won't carry a nonce; browser CSP refuses them;
//      React hydration silently fails. The static HTML response is
//      still valid (we use class-based styles, no inline-style
//      attributes that would need style-src-attr). User sees the
//      correct message and the home link works.
//   2. The `useEffect` Sentry capture below depends on hydration
//      succeeding, so a global error that ALSO falls under this
//      no-nonce-during-error scenario won't reach Sentry through this
//      path. We still get the underlying error via the server-side
//      Sentry SDK in `instrumentation.ts`.
//
// Net: visible-content is intact, observability is degraded for the
// edge case of "global error AND CSP nonce trigger missing." Since
// global-error itself is rare (page-level error.tsx catches first),
// this is acceptable.

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ru">
      <body className="global-error-body">
        <div className="global-error-card">
          <h1 className="global-error-title">Что-то пошло не так</h1>
          <p className="global-error-text">
            Мы уже знаем об ошибке и разбираемся. Попробуйте обновить страницу
            через минуту. Если не поможет — напишите нам в Telegram.
          </p>
          <a href="/" className="global-error-back">
            На главную
          </a>
        </div>
      </body>
    </html>
  )
}
