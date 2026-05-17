'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ALERTS-EDITOR Sub-PR C (2026-05-18) — per-key editor input.
// Plan: docs/plans/alerts-editor.md §4.3.
//
// Renders the current value + source badge + an inline input +
// Save/Reset buttons. Save POSTs to /api/admin/settings/alerts/setting/[key]
// with expectedUpdatedAt for optimistic concurrency. Reset DELETEs.
// On 409 the UI hard-refreshes (re-renders with the new server state)
// and asks the operator to re-submit.

type SettingMeta = {
  kind: 'int' | 'decimal'
  default: number
  min: number
  max: number
  decimalPlaces?: number
  envName: string
  description: string
}

type Props = {
  settingKey: string
  meta: SettingMeta
  value: number
  source: 'db' | 'env' | 'default'
  rawDb: string | null
  rawEnv: string | null
  updatedAt: string | null
  disabled?: boolean
}

function formatValue(value: number, meta: SettingMeta): string {
  if (meta.kind === 'decimal') {
    return value.toFixed(meta.decimalPlaces ?? 2)
  }
  return String(value)
}

export function SettingEditor(props: Props) {
  const { settingKey, meta, value, source, rawDb, rawEnv, updatedAt } =
    props
  const router = useRouter()
  const [draft, setDraft] = useState(formatValue(value, meta))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Wave-R2 WARN #1 closure — re-sync draft from server props after
  // router.refresh() (save / reset / 409 paths). Without this the
  // input would keep the stale local draft and offer to re-submit an
  // already-committed value.
  useEffect(() => {
    setDraft(formatValue(value, meta))
  }, [value, meta])

  const malformed =
    rawDb !== null && source !== 'db'
      ? `DB row "${rawDb}" не прошёл валидацию (используется ${source})`
      : null

  async function save() {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(
        `/api/admin/settings/alerts/setting/${encodeURIComponent(settingKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value: draft,
            expectedUpdatedAt: updatedAt,
          }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (res.status === 409) {
          setErr(
            'Конфликт: значение изменилось параллельно. Страница обновится — повторите.',
          )
          router.refresh()
        } else if (res.status === 400) {
          setErr(`Не валидно (${data.error ?? 'invalid_body'})`)
        } else if (res.status === 503) {
          setErr('Миграция 0055 не применена на этом сервере.')
        } else if (res.status === 401 || res.status === 403) {
          setErr('Нет прав admin.')
        } else {
          setErr(`HTTP ${res.status}`)
        }
        return
      }
      setInfo('Сохранено.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!updatedAt) return
    if (!confirm(`Сбросить ${settingKey} к env/default?`)) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(
        `/api/admin/settings/alerts/setting/${encodeURIComponent(settingKey)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        if (res.status === 409) {
          setErr('Конфликт — обновляю страницу.')
          router.refresh()
        } else {
          setErr(`HTTP ${res.status} (${data.error ?? '—'})`)
        }
        return
      }
      setInfo('Сброшено к env/default.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const sourceBadge = (() => {
    if (source === 'db') return { label: 'DB', color: '#1f6feb' }
    if (source === 'env') return { label: 'env', color: '#8957e5' }
    return { label: 'default', color: '#6e7681' }
  })()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '8px 0',
        borderTop: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 2,
          }}
        >
          <code style={{ fontSize: 12, fontWeight: 600 }}>{settingKey}</code>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 3,
              background: sourceBadge.color,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {sourceBadge.label}
          </span>
          {malformed ? (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: '#c97a00',
                color: '#fff',
              }}
              title={malformed}
            >
              MALFORMED
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--secondary)',
            lineHeight: 1.4,
          }}
        >
          {meta.description}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--secondary)',
            marginTop: 2,
          }}
        >
          range [{formatValue(meta.min, meta)} .. {formatValue(meta.max, meta)}]
          · default {formatValue(meta.default, meta)}
          {rawEnv ? <> · env: <code>{rawEnv}</code></> : null}
        </div>
      </div>
      <div
        style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}
      >
        <input
          type="text"
          value={draft}
          disabled={busy || props.disabled}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            padding: '4px 8px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 4,
            width: 96,
            background: 'var(--background)',
            color: 'var(--foreground)',
            fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || props.disabled || draft === formatValue(value, meta)}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: 'transparent',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy || props.disabled || !updatedAt}
          title={updatedAt ? 'Сбросить DB-значение' : 'Нет DB-значения для сброса'}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: 'transparent',
            color: 'var(--secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Сбросить
        </button>
      </div>
      {err ? (
        <div style={{ width: '100%', color: '#b00020', fontSize: 12 }}>
          {err}
        </div>
      ) : null}
      {info ? (
        <div style={{ width: '100%', color: '#1a7f37', fontSize: 12 }}>
          {info}
        </div>
      ) : null}
    </div>
  )
}
