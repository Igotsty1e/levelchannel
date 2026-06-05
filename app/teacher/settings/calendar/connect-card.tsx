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
  timezoneNotSet = false,
}: {
  configReady: boolean
  configError: string | null
  isConnected: boolean
  syncState: 'active' | 'degraded' | 'disconnected' | null
  lastReconnectedAt: string | null
  /**
   * calendar-onboarding-cleanup (2026-06-05) — when true (teacher's
   * profile.timezone IS NULL), disable the Connect button and replace
   * the explainer copy with a "fill timezone first" hint. The SSR page
   * renders a banner with a profile link above the card; this prop
   * mirrors the gate state inside the card.
   */
  timezoneNotSet?: boolean
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

  // TASK-6 (teacher-cabinet-polish sub-PR A) — both configError and
  // !configReady branches render the same neutral "Скоро будет" tile.
  // The raw configError detail stays out of the DOM (no operator email
  // exposure, no stack-trace <details>) — it's logged server-side, and
  // the boot-guard already surfaces config drift to ops via Sentry.
  // When env vars flip on later (`configReady === true`), the connect
  // branch below renders automatically — no second deploy needed.
  if (configError || !configReady) {
    return (
      <div
        data-testid="calendar-coming-soon-tile"
        style={{
          padding: 16,
          background: 'var(--surface-2, rgba(255,255,255,0.03))',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {/* content-style-allow — state-aware: surfaces only when configError || !configReady; flips automatically when GOOGLE_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URL + GOOGLE_OAUTH_STATE_SECRET are all set and valid in prod env (see lib/calendar/google/config.ts validators). See evals/PRODUCT_FLOWS.md FLOW-TEACHER-CALENDAR-SETTINGS-001. */}
        🛠 Скоро будет — функция активируется в ближайшем обновлении.
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
            {timezoneNotSet
              ? 'Сначала укажите часовой пояс в профиле — кнопка активируется после сохранения.'
              : 'После нажатия «Подключить» вы попадёте на страницу Google, где подтвердите доступ. Это безопасно: LevelChannel получит только права читать и записывать события в указанный календарь, ничего больше.'}
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={busy !== null || timezoneNotSet}
            style={{
              padding: '12px 24px',
              background: 'var(--accent, #3b82f6)',
              color: 'var(--accent-contrast, #fff)',
              border: 'none',
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 600,
              cursor:
                busy === 'connect'
                  ? 'wait'
                  : timezoneNotSet
                    ? 'not-allowed'
                    : 'pointer',
              opacity: busy || timezoneNotSet ? 0.6 : 1,
            }}
          >
            {busy === 'connect' ? 'Переходим в Google…' : 'Подключить Google Calendar'}
          </button>
        </>
      )}
    </div>
  )
}
