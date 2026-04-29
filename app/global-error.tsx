'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

// Top-level React error boundary. Forwards to Sentry, then renders a
// minimal Russian-language fallback. Note: this fires for errors that
// escape page-level error.tsx — rare, but the only place global render
// failures get a chance to be captured.

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
      <body
        style={{
          background: '#0B0B0C',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Что-то пошло не так</h1>
          <p style={{ color: '#A1A1AA', lineHeight: 1.6, marginBottom: 24 }}>
            Мы уже знаем об ошибке и разбираемся. Попробуйте обновить страницу
            через минуту. Если не поможет — напишите нам в Telegram.
          </p>
          <a
            href="/"
            style={{
              color: '#fff',
              textDecoration: 'underline',
              fontSize: 14,
            }}
          >
            На главную
          </a>
        </div>
      </body>
    </html>
  )
}
