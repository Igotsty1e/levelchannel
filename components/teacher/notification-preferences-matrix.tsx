'use client'

// Epic D — UI матрица per-event × per-channel notification preferences
// (2026-06-18).
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic D.
//
// Default behaviour: всё включено. Backward-compat: если записи нет —
// toggle показывает ON. Toggle OFF → upsert через PATCH. Сохраняем по
// одному изменению (минимум сетевой работы; debounce можно добавить позже).

import { useState } from 'react'
import { CollapsibleCard } from '@/components/ui/primitives'
import {
  NOTIFICATION_CHANNELS_UI,
  NOTIFICATION_EVENT_CATALOG,
  type NotificationChannel,
} from '@/lib/notifications/catalog'

type PrefRow = {
  eventKind: string
  channel: NotificationChannel
  enabled: boolean
}

type Props = {
  initialPreferences: ReadonlyArray<PrefRow>
  channels?: ReadonlyArray<NotificationChannel>
}

function prefMapKey(eventKind: string, channel: NotificationChannel): string {
  return `${eventKind}::${channel}`
}

function buildInitialMap(
  rows: ReadonlyArray<PrefRow>,
): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const r of rows) {
    map[prefMapKey(r.eventKind, r.channel)] = r.enabled
  }
  return map
}

export function NotificationPreferencesMatrix({
  initialPreferences,
  channels = NOTIFICATION_CHANNELS_UI.map(({ channel }) => channel),
}: Props) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    buildInitialMap(initialPreferences),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const visibleChannels = NOTIFICATION_CHANNELS_UI.filter(({ channel }) =>
    channels.includes(channel),
  )

  const isEnabled = (eventKind: string, channel: NotificationChannel) => {
    const k = prefMapKey(eventKind, channel)
    if (k in prefs) return prefs[k]
    return true // default ON
  }

  const toggle = async (
    eventKind: string,
    channel: NotificationChannel,
  ) => {
    const next = !isEnabled(eventKind, channel)
    const k = prefMapKey(eventKind, channel)
    setPrefs((prev) => ({ ...prev, [k]: next }))
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/notification-preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          updates: [{ eventKind, channel, enabled: next }],
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.message ?? 'Не удалось сохранить.')
        // Откатываем optimistic update.
        setPrefs((prev) => ({ ...prev, [k]: !next }))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить.')
      setPrefs((prev) => ({ ...prev, [k]: !next }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="card lc-section"
      data-testid="notification-prefs-matrix"
      style={{ marginTop: 32, padding: 20 }}
      aria-label="Гранулярные настройки уведомлений"
    >
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Что и куда присылать
        </h2>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          Отключите конкретные события в конкретных каналах — например,
          оставьте e-mail и выключите Telegram. По умолчанию всё
          включено.
        </p>
      </header>

      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {err}
        </p>
      ) : null}

      <div className="lc-stack-card">
        {NOTIFICATION_EVENT_CATALOG.map((group) => (
          <CollapsibleCard
            key={group.group}
            title={group.groupLabel}
            description={groupDescription(group.group)}
            meta={
              <span style={groupMetaStyle}>
                {group.items.length} {pluralizeEvents(group.items.length)}
              </span>
            }
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thLeftStyle}>Событие</th>
                  {visibleChannels.map((c) => (
                    <th key={c.channel} style={thCenterStyle}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr
                    key={item.kind}
                    data-testid={`notification-prefs-row-${item.kind}`}
                  >
                    <td style={tdLeftStyle}>
                      <div style={{ fontSize: 14, color: 'var(--text)' }}>
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--secondary)',
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {item.desc}
                      </div>
                    </td>
                    {visibleChannels.map((c) => {
                      const on = isEnabled(item.kind, c.channel)
                      return (
                        <td key={c.channel} style={tdCenterStyle}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${item.label} — ${c.label}`}
                            data-testid={`notification-prefs-toggle-${item.kind}-${c.channel}`}
                            onClick={() => void toggle(item.kind, c.channel)}
                            disabled={busy}
                            style={{
                              ...toggleStyle,
                              background: on
                                ? 'var(--accent)'
                                : 'var(--surface-2, #2a2a35)',
                            }}
                          >
                            <span
                              style={{
                                ...toggleDotStyle,
                                left: on ? 20 : 2,
                              }}
                            />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsibleCard>
        ))}
      </div>
    </section>
  )
}

function groupDescription(group: string): string {
  switch (group) {
    case 'schedule':
      return 'Отмены, переносы и назначение уроков.'
    case 'payments':
      return 'Оплата вне сервиса, подтверждения и возвраты.'
    case 'reminders':
      return 'Что происходит после урока.'
    default:
      return ''
  }
}

function pluralizeEvents(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'событие'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'события'
  }
  return 'событий'
}

const groupMetaStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 12,
  lineHeight: 1.3,
  whiteSpace: 'nowrap',
}

const thLeftStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 500,
  textAlign: 'left',
  padding: '10px 0',
}

const thCenterStyle: React.CSSProperties = {
  ...thLeftStyle,
  textAlign: 'center',
  width: 88,
}

const tdLeftStyle: React.CSSProperties = {
  padding: '14px 14px 14px 0',
  borderTop: '1px solid var(--border)',
}

const tdCenterStyle: React.CSSProperties = {
  padding: '14px 0',
  borderTop: '1px solid var(--border)',
  textAlign: 'center',
}

const toggleStyle: React.CSSProperties = {
  position: 'relative',
  width: 40,
  height: 22,
  borderRadius: 11,
  border: 0,
  cursor: 'pointer',
  transition: 'background 150ms ease',
  padding: 0,
  outline: 'none',
}

const toggleDotStyle: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#fff',
  transition: 'left 150ms ease',
}
