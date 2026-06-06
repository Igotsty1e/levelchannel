'use client'

import { useEffect, useState } from 'react'

import type { LearnerPushState } from '@/lib/notifications/learner-push-state'

// BCS-DEF-4-PUSH (2026-06-06) — Web Push opt-in client island on
// /cabinet/profile. Renders the 4-state contract from
// resolveLearnerPushState; the `disabled` case is handled by the
// SSR parent (section hidden entirely).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.9

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; message: string }

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function arrayBufferToB64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function SectionFrame({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        marginTop: 24,
        padding: 24,
        background: 'var(--panel, #11141a)',
        border: '1px solid var(--border, #1f2230)',
        borderRadius: 12,
      }}
      aria-labelledby="push-section-heading"
    >
      <h2
        id="push-section-heading"
        style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}
      >
        Напоминания о начале урока в браузере
      </h2>
      <p style={{ color: 'var(--secondary)', fontSize: 14, marginBottom: 16 }}>
        Браузер показывает напоминание о начале занятия даже если вкладка
        LevelChannel закрыта.
      </p>
      {children}
    </section>
  )
}

export function LearnerPushSubscription({
  initialState,
}: {
  initialState: Exclude<LearnerPushState, { kind: 'disabled' }>
}) {
  const [state, setState] = useState(initialState)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [supportError, setSupportError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setSupportError('Браузер не поддерживает уведомления о начале урока.')
    }
  }, [])

  if (state.kind === 'unconfigured') {
    return (
      <SectionFrame>
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          {/* content-style-allow — state-aware placeholder for the operator-side VAPID env gap; resolves automatically once PUSH_VAPID_PUBLIC_KEY / PRIVATE / SUBJECT are rendered into $ENV_FILE (see OPERATIONS.md §LEARNER_REMINDERS_PUSH_ENABLED). */ ''}
          Скоро будет — оператор завершает настройку напоминаний в браузере.
        </p>
      </SectionFrame>
    )
  }
  if (state.kind === 'migrationPending') {
    return (
      <SectionFrame>
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          {/* content-style-allow — state-aware placeholder for the deploy-before-migrate window for mig 0109; resolves automatically once migrations run. */ ''}
          Скоро будет.
        </p>
      </SectionFrame>
    )
  }

  async function refreshState() {
    const res = await fetch('/cabinet/profile', { method: 'GET' }).catch(
      () => null,
    )
    void res
    // SSR is the source of truth; soft-refresh by reloading once the
    // user is done. Simpler than threading a state-refetch endpoint
    // through for this MVP.
  }

  async function subscribe() {
    if (state.kind !== 'ready') return
    if (supportError) return
    setStatus({ kind: 'working' })
    try {
      let perm = Notification.permission
      if (perm === 'default') {
        perm = await Notification.requestPermission()
      }
      if (perm !== 'granted') {
        setStatus({
          kind: 'error',
          message:
            perm === 'denied'
              ? 'Браузер запретил уведомления. Включите их в настройках сайта.'
              : 'Уведомления не подтверждены.',
        })
        return
      }
      const reg = await navigator.serviceWorker.ready
      const applicationServerKey = urlBase64ToUint8Array(state.vapidPublicKey)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // @ts-expect-error - Uint8Array<ArrayBuffer> is the spec shape;
        //   TS lib types accept BufferSource which Uint8Array implements.
        applicationServerKey,
      })
      const json = sub.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
      const endpoint = String(json.endpoint ?? sub.endpoint ?? '')
      const p256dh =
        json.keys?.p256dh ??
        arrayBufferToB64Url(sub.getKey('p256dh'))
      const auth =
        json.keys?.auth ?? arrayBufferToB64Url(sub.getKey('auth'))
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: 'Не удалось подключить уведомления.',
        })
        return
      }
      setStatus({
        kind: 'ok',
        message: 'Уведомления подключены.',
      })
      await refreshState()
      // Locally append the new device so the user sees feedback
      // without a full page refresh.
      setState({
        ...state,
        activeDevices: [
          {
            id: 'pending',
            userAgent: navigator.userAgent,
            lastUsedAt: null,
          },
          ...state.activeDevices.filter((d) => d.id !== 'pending'),
        ],
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? `Ошибка подключения: ${err.message}`
            : 'Ошибка подключения.',
      })
    }
  }

  async function unsubscribeDevice(deviceId: string) {
    if (state.kind !== 'ready') return
    setStatus({ kind: 'working' })
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      const endpoint = sub?.endpoint ?? ''
      if (!endpoint) {
        setStatus({
          kind: 'error',
          message: 'Не удалось найти подписку в браузере.',
        })
        return
      }
      const res = await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })
      if (!res.ok) {
        setStatus({ kind: 'error', message: 'Не удалось отключить.' })
        return
      }
      try {
        await sub?.unsubscribe()
      } catch {
        /* swallow — server-side row is already flipped */
      }
      setStatus({ kind: 'ok', message: 'Уведомления отключены.' })
      setState({
        ...state,
        activeDevices: state.activeDevices.filter((d) => d.id !== deviceId),
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? `Ошибка отключения: ${err.message}`
            : 'Ошибка отключения.',
      })
    }
  }

  return (
    <SectionFrame>
      {supportError ? (
        <p
          role="alert"
          style={{ color: 'var(--secondary)', fontSize: 14 }}
        >
          {supportError}
        </p>
      ) : null}
      {state.activeDevices.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          Сейчас уведомления не подключены ни на одном устройстве.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 12px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {state.activeDevices.map((d) => (
            <li
              key={d.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 12px',
                border: '1px solid var(--border, #1f2230)',
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--text)' }}>
                {d.userAgent
                  ? d.userAgent.slice(0, 80)
                  : 'Устройство без идентификатора'}
              </span>
              <button
                type="button"
                onClick={() => unsubscribeDevice(d.id)}
                disabled={status.kind === 'working'}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  background: 'transparent',
                  border: '1px solid var(--border, #1f2230)',
                  color: 'var(--secondary)',
                  cursor: 'pointer',
                }}
              >
                Отключить
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={subscribe}
        disabled={status.kind === 'working' || Boolean(supportError)}
        style={{
          padding: '10px 16px',
          fontSize: 14,
          borderRadius: 8,
          background: 'var(--accent, #4f7cff)',
          color: '#fff',
          border: 'none',
          cursor: status.kind === 'working' ? 'wait' : 'pointer',
        }}
      >
        {status.kind === 'working'
          ? 'Подключаем…'
          : 'Подключить напоминания в браузере'}
      </button>
      <p
        style={{
          fontSize: 12,
          color: 'var(--secondary)',
          marginTop: 12,
        }}
      >
        Доступно в Chrome / Firefox / Edge / Safari 16.4+ в режиме PWA.
      </p>
      {status.kind === 'error' ? (
        <p
          role="alert"
          style={{ fontSize: 13, color: 'var(--danger, #ff6363)', marginTop: 8 }}
        >
          {status.message}
        </p>
      ) : null}
      {status.kind === 'ok' ? (
        <p style={{ fontSize: 13, color: 'var(--success, #58c473)', marginTop: 8 }}>
          {status.message}
        </p>
      ) : null}
    </SectionFrame>
  )
}
