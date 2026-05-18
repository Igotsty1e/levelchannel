'use client'

import { useEffect, useState } from 'react'

import { postAuthJson } from '@/lib/auth/client'

// SAAS-4 TINV.5 (2026-05-18) — teacher's invite-generation card.
//
// Renders disabled placeholder when !isVerified (round-2 WARN#9): the
// active controls (POST /api/teacher/invites) require requireTeacher-
// AndVerified server-side. Showing a clickable button that 403s is
// worse than showing the gated state explicitly.

type Props = {
  isVerified: boolean
}

type InviteRow = {
  id: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedByEmail: string | null
  revokedAt: string | null
  status: 'active' | 'used' | 'revoked' | 'expired'
}

type CreatedInvite = {
  id: string
  url: string
  expiresAt: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: InviteRow['status']): string {
  switch (status) {
    case 'active':
      return 'не использовано'
    case 'used':
      return 'использовано'
    case 'revoked':
      return 'отозвано'
    case 'expired':
      return 'истёк срок действия'
  }
}

export function TeacherInviteSection({ isVerified }: Props) {
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [created, setCreated] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!isVerified) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerified])

  async function refresh() {
    try {
      const res = await fetch('/api/teacher/invites', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok) setInvites(data.invites as InviteRow[])
    } catch {
      /* swallow — UI shows the empty list */
    }
  }

  async function onGenerate() {
    if (busy) return
    setBusy(true)
    setErr(null)
    const result = await postAuthJson('/api/teacher/invites', {})
    setBusy(false)
    if (!result.ok) {
      setErr(result.error)
      return
    }
    const data = result.data as unknown as CreatedInvite
    setCreated((prev) => {
      const next = new Map(prev)
      next.set(data.id, data.url)
      return next
    })
    await refresh()
  }

  async function onRevoke(id: string) {
    if (busy) return
    if (!window.confirm('Отозвать это приглашение?')) return
    setBusy(true)
    setErr(null)
    const result = await postAuthJson(`/api/teacher/invites/${encodeURIComponent(id)}/revoke`, {})
    setBusy(false)
    if (!result.ok) {
      setErr(result.error)
      return
    }
    await refresh()
  }

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard API can fail under permissions; user can still
       *  select and copy manually from the link below. */
    }
  }

  if (!isVerified) {
    return (
      <section
        className="card"
        style={{ padding: 24, marginBottom: 24, marginTop: 24 }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Пригласить ученика
        </h3>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Чтобы открыть приглашения учеников, подтвердите свой e-mail.
        </p>
      </section>
    )
  }

  return (
    <section
      className="card"
      style={{ padding: 24, marginBottom: 24, marginTop: 24 }}
    >
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Пригласить ученика
      </h3>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        Нажмите кнопку — мы создадим персональную ссылку. Скопируйте её и
        отправьте ученику любым способом (мессенджер, e-mail, СМС). Ссылка
        действует 7 дней и подходит только для одного ученика.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className="btn-primary"
        style={{ marginBottom: err ? 12 : 16 }}
      >
        {busy ? 'Создаём…' : 'Создать ссылку-приглашение'}
      </button>
      {err ? (
        <p style={{ color: '#ff6b6b', fontSize: 13, marginBottom: 12 }}>{err}</p>
      ) : null}

      {invites.length > 0 ? (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {invites.map((row) => {
            const sessionUrl = created.get(row.id) ?? null
            return (
              <li
                key={row.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: 'var(--secondary)' }}>
                    Создано: {formatDate(row.createdAt)} —{' '}
                    {statusLabel(row.status)}
                    {row.usedByEmail ? ` (${row.usedByEmail})` : ''}
                  </span>
                  {row.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => onRevoke(row.id)}
                      disabled={busy}
                      style={{
                        background: 'transparent',
                        color: '#ff6b6b',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      Отозвать
                    </button>
                  ) : null}
                </div>
                {sessionUrl ? (
                  <div
                    style={{
                      marginTop: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <code
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                        color: 'var(--text)',
                      }}
                    >
                      {sessionUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(sessionUrl)}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--text)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Скопировать
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
          Пока нет ни одного приглашения.
        </p>
      )}
    </section>
  )
}
