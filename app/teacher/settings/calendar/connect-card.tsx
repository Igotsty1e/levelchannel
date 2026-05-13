'use client'

import { useState } from 'react'

// BCS-C.4 — connect/disconnect card. Client island so the connect
// button can POST /start, receive { authorizationUrl }, and navigate.
//
// Server-rendered banners (?connected=1, ?error=...) live in the
// parent page so they're visible on first paint without client hydration.

export function CalendarConnectCard({
  configReady,
  configError,
  isConnected,
  syncState,
  lastReconnectedAt,
}: {
  configReady: boolean
  configError: string | null
  isConnected: boolean
  syncState: 'active' | 'degraded' | 'disconnected' | null
  lastReconnectedAt: string | null
}) {
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy('connect')
    setError(null)
    try {
      const res = await fetch('/api/teacher/calendar/google/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(
          data.message
            || data.error
            || `Не удалось начать подключение (HTTP ${res.status})`,
        )
        return
      }
      const { authorizationUrl } = (await res.json()) as {
        authorizationUrl: string
      }
      window.location.href = authorizationUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      // Do not reset busy — page is about to navigate.
    }
  }

  async function disconnect() {
    if (
      !confirm(
        'Отключить интеграцию с Google Calendar? Уже записанные в Google уроки останутся как есть.',
      )
    ) {
      return
    }
    setBusy('disconnect')
    setError(null)
    try {
      const res = await fetch('/api/teacher/calendar/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(
          data.message
            || data.error
            || `Не удалось отключить (HTTP ${res.status})`,
        )
        return
      }
      // Reload so the server-rendered status flips.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setBusy(null)
    }
  }

  if (configError) {
    return (
      <div
        style={{
          padding: 16,
          background: 'rgba(255,138,138,0.12)',
          border: '1px solid rgba(255,138,138,0.4)',
          borderRadius: 8,
          color: '#ffb0b0',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        ⚠ Интеграция не настроена на этом окружении. Напишите оператору.
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>
            Подробнее
          </summary>
          <pre
            style={{
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: '8px 0 0 0',
            }}
          >
            {configError}
          </pre>
        </details>
      </div>
    )
  }

  if (!configReady) {
    return (
      <div
        style={{
          padding: 16,
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--secondary)',
          fontSize: 14,
        }}
      >
        ℹ Интеграция временно недоступна на этом окружении (dev / staging).
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 20,
        background: 'var(--surface-2, rgba(255,255,255,0.03))',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: isConnected
              ? 'rgba(155,223,155,0.15)'
              : 'rgba(180,180,180,0.15)',
            color: isConnected ? '#9bdf9b' : 'var(--secondary)',
          }}
        >
          {syncState === 'active'
            ? '● Подключено'
            : syncState === 'degraded'
              ? '● Подключено (синхронизация устарела)'
              : '○ Не подключено'}
        </span>
        {lastReconnectedAt ? (
          <span
            style={{
              marginLeft: 12,
              fontSize: 12,
              color: 'var(--secondary)',
            }}
          >
            Подключено{' '}
            {new Date(lastReconnectedAt).toLocaleString('ru-RU', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            color: '#ffb0b0',
            fontSize: 13,
            margin: '0 0 12px 0',
          }}
        >
          {error}
        </p>
      ) : null}

      {isConnected ? (
        <button
          type="button"
          onClick={disconnect}
          disabled={busy !== null}
          style={{
            padding: '10px 20px',
            background: 'transparent',
            color: '#ffb0b0',
            border: '1px solid rgba(255,138,138,0.5)',
            borderRadius: 8,
            fontSize: 14,
            cursor: busy === 'disconnect' ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'disconnect' ? 'Отключаем…' : 'Отключить Google Calendar'}
        </button>
      ) : (
        <>
          <p
            style={{
              fontSize: 14,
              margin: '0 0 12px 0',
              lineHeight: 1.6,
            }}
          >
            После нажатия «Подключить» вы попадёте на страницу Google, где
            подтвердите доступ. Это безопасно: LevelChannel получит только
            права читать и записывать события в указанный календарь,
            ничего больше.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={busy !== null}
            style={{
              padding: '12px 24px',
              background: 'var(--accent, #3b82f6)',
              color: 'var(--accent-contrast, #fff)',
              border: 'none',
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 600,
              cursor: busy === 'connect' ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy === 'connect' ? 'Переходим в Google…' : 'Подключить Google Calendar'}
          </button>
        </>
      )}
    </div>
  )
}
