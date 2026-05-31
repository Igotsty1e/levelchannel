'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import type {
  LegalDocKind,
  LegalDocumentVersion,
} from '@/lib/legal/versions'

type KindLabel = { kind: LegalDocKind; label: string; humanPath: string }

const KINDS: KindLabel[] = [
  { kind: 'offer', label: 'Оферта', humanPath: '/offer' },
  { kind: 'privacy', label: 'Политика обработки ПДн', humanPath: '/privacy' },
  {
    kind: 'personal_data',
    label: 'Согласие на обработку ПДн',
    humanPath: '/consent/personal-data',
  },
  { kind: 'saas_offer', label: 'SaaS-оферта', humanPath: '/saas/offer' },
  {
    kind: 'saas_processor_terms',
    label: 'Приложение № 1 — Условия поручения',
    humanPath: '/saas/processor-terms',
  },
]

type Props = {
  initial: Record<LegalDocKind, LegalDocumentVersion[]>
}

export function LegalVersionsManager({ initial }: Props) {
  const [tab, setTab] = useState<LegalDocKind>('offer')
  const versions = initial[tab]
  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {KINDS.map((k) => {
          const active = tab === k.kind
          return (
            <button
              key={k.kind}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(k.kind)}
              style={{
                padding: '8px 14px',
                background: active ? 'rgba(34, 197, 94, 0.18)' : 'transparent',
                border: '1px solid',
                borderColor: active
                  ? 'rgba(34, 197, 94, 0.55)'
                  : 'var(--border)',
                borderBottomColor: active
                  ? 'rgba(34, 197, 94, 0.55)'
                  : 'transparent',
                borderTopLeftRadius: 6,
                borderTopRightRadius: 6,
                color: active ? '#bbf7d0' : 'var(--text)',
                fontSize: 13,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {k.label}
            </button>
          )
        })}
      </div>

      <VersionsList versions={versions} kindLabel={tab} />
      <PublishForm kind={tab} />
    </div>
  )
}

function VersionsList({
  versions,
  kindLabel,
}: {
  versions: LegalDocumentVersion[]
  kindLabel: LegalDocKind
}) {
  if (versions.length === 0) {
    return (
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 24 }}>
        Версий ещё нет.
      </p>
    )
  }
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Опубликованные версии ({kindLabel})
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {versions.map((v) => (
          <li
            key={v.id}
            style={{
              padding: '12px 0',
              borderBottom: '1px solid var(--border)',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 16,
              alignItems: 'baseline',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {v.versionLabel}{' '}
                <span
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 12,
                    fontWeight: 400,
                    marginLeft: 8,
                  }}
                >
                  с {new Date(v.effectiveFrom).toLocaleString('ru-RU')}
                </span>
              </div>
              <div
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12,
                  marginTop: 4,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: 1.5,
                }}
              >
                {v.bodyMd.slice(0, 240)}
                {v.bodyMd.length > 240 ? '…' : ''}
              </div>
            </div>
            <a
              href={`/legal/v/${v.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                color: 'var(--accent, #6ea8fe)',
              }}
            >
              открыть →
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PublishForm({ kind }: { kind: LegalDocKind }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [versionLabel, setVersionLabel] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function publish() {
    setErr(null)
    setInfo(null)
    if (!versionLabel.trim()) {
      setErr('Укажите ярлык версии (например v2 или 2026-05-15).')
      return
    }
    if (!bodyMd.trim()) {
      setErr('Тело документа не может быть пустым.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/legal/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docKind: kind,
          versionLabel: versionLabel.trim(),
          bodyMd,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(data.error || `HTTP ${res.status}`)
        return
      }
      setInfo('Версия опубликована.')
      setVersionLabel('')
      setBodyMd('')
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Опубликовать новую версию
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
            Ярлык версии
          </span>
          <input
            type="text"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="v2"
            maxLength={32}
            style={{
              padding: '8px 12px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
            Текст (Markdown)
          </span>
          <textarea
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            rows={20}
            style={{
              padding: '12px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              lineHeight: 1.5,
              resize: 'vertical',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={publish}
            disabled={busy || pending}
            style={{
              padding: '8px 18px',
              background: 'rgba(34, 197, 94, 0.18)',
              border: '1px solid rgba(34, 197, 94, 0.55)',
              borderRadius: 6,
              color: '#bbf7d0',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || pending ? 'not-allowed' : 'pointer',
              opacity: busy || pending ? 0.6 : 1,
            }}
          >
            {busy ? 'Публикуем…' : 'Опубликовать'}
          </button>
          {info ? (
            <span style={{ color: '#9bdf9b', fontSize: 12 }}>{info}</span>
          ) : null}
          {err ? (
            <span style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
