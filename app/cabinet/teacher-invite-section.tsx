'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { postAuthJson } from '@/lib/auth/client'
import type { TeacherPlanLearnerLimit } from '@/lib/onboarding/teacher-plan-limit'

// SAAS-4 TINV.5 (2026-05-18) — teacher's invite-generation card.
//
// Renders disabled placeholder when !isVerified (round-2 WARN#9): the
// active controls (POST /api/teacher/invites) require requireTeacher-
// AndVerified server-side. Showing a clickable button that 403s is
// worse than showing the gated state explicitly.

type Props = {
  isVerified: boolean
  planLearnerLimit?: TeacherPlanLearnerLimit
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
  defaultPaymentMethod?: 'postpaid' | 'prepaid_packages' | 'none'
}

type DefaultPaymentMethod = 'none' | 'postpaid' | 'prepaid_packages'

// Per-learner-payment-method §Scope item 6 — invite-flow default
// selector. Russian labels mirror the teacher learner-card selector
// copy ("Постоплата" / "Предоплата пакетами" / "Не выбрано").
const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{
  value: DefaultPaymentMethod
  label: string
  hint: string
}> = [
  {
    value: 'none',
    label: 'Не выбирать сейчас',
    hint: 'Решите позже на карточке ученика.',
  },
  {
    value: 'postpaid',
    label: 'Постоплата',
    hint: 'Ученик платит после занятия.',
  },
  {
    value: 'prepaid_packages',
    label: 'Предоплата пакетами',
    hint: 'Ученик покупает пакет занятий заранее.',
  },
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = new Date().getFullYear() === d.getFullYear()
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
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
      return 'истекло'
  }
}

export function TeacherInviteSection({ isVerified, planLearnerLimit }: Props) {
  const limited = planLearnerLimit?.kind === 'limited' ? planLearnerLimit : null
  const isHardLimit = !!limited && limited.activeCount >= limited.limit
  const isSoftLimit =
    !!limited &&
    !isHardLimit &&
    limited.activeCount >= Math.ceil(0.8 * limited.limit)
  const limitTone: 'ok' | 'soft' | 'hard' = isHardLimit
    ? 'hard'
    : isSoftLimit
      ? 'soft'
      : 'ok'
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [created, setCreated] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [defaultMethod, setDefaultMethod] =
    useState<DefaultPaymentMethod>('none')
  // Onboarding Sub-PR B3 — `teacher-invite-copy-feedback` toast slot.
  // Spec §1.1: show «Ссылка скопирована» on success OR a fallback
  // «Не удалось скопировать автоматически — выделите ссылку ниже и
  // скопируйте вручную» on clipboard API failure. Client-only; no
  // persistence (toasts are transient by definition).
  const [copyToast, setCopyToast] = useState<
    | { kind: 'success'; key: number }
    | { kind: 'fail'; key: number }
    | null
  >(null)

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
    const result = await postAuthJson('/api/teacher/invites', {
      defaultPaymentMethod: defaultMethod,
    })
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
      setCopyToast({ kind: 'success', key: Date.now() })
    } catch {
      // clipboard API can fail under permissions; show a fallback
      // toast that points the user at the visible link below the
      // button (round-3 SaaS-Pivot pattern — explicit failure UX).
      setCopyToast({ kind: 'fail', key: Date.now() })
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Пригласить ученика
        </h3>
        {limited ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
                background:
                  limitTone === 'hard'
                    ? 'rgba(224,118,118,0.14)'
                    : limitTone === 'soft'
                      ? 'rgba(243,180,107,0.14)'
                      : 'rgba(255,255,255,0.05)',
                color:
                  limitTone === 'hard'
                    ? '#ff8a8a'
                    : limitTone === 'soft'
                      ? '#f3b46b'
                      : 'var(--secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
              title={`Активных учеников на тарифе ${limited.planTitleRu}`}
            >
              {limited.activeCount}/{limited.limit} учеников
            </span>
            {isHardLimit ? (
              <Link
                href="/teacher/subscription"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'var(--danger, #e07676)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  lineHeight: 1.2,
                }}
              >
                Обновить тариф
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      {copyToast ? (
        <div
          key={copyToast.key}
          role="status"
          aria-live="polite"
          style={{
            background:
              copyToast.kind === 'success'
                ? 'rgba(110, 168, 254, 0.12)'
                : 'rgba(224, 118, 118, 0.12)',
            border: `1px solid ${
              copyToast.kind === 'success'
                ? 'var(--accent, #6ea8fe)'
                : 'var(--danger, #e07676)'
            }`,
            color:
              copyToast.kind === 'success'
                ? 'var(--text)'
                : 'var(--danger, #e07676)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {copyToast.kind === 'success'
            ? 'Ссылка скопирована'
            : 'Не удалось скопировать автоматически — выделите ссылку ниже и скопируйте вручную.'}
        </div>
      ) : null}
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        Создайте ссылку и отправьте ученику. Действует 7 дней, для одного человека.
      </p>
      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="invite-default-payment-method"
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Как ученик будет платить
        </label>
        <select
          id="invite-default-payment-method"
          value={defaultMethod}
          onChange={(e) =>
            setDefaultMethod(e.target.value as DefaultPaymentMethod)
          }
          disabled={busy}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--text)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {PAYMENT_METHOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            marginTop: 6,
            lineHeight: 1.4,
          }}
        >
          {PAYMENT_METHOD_OPTIONS.find((o) => o.value === defaultMethod)?.hint}
        </p>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={busy || isHardLimit}
        className="btn-primary"
        title={
          isHardLimit
            ? `Достигнут лимит ${limited!.activeCount}/${limited!.limit} учеников. Обновите тариф.`
            : undefined
        }
        style={{ marginBottom: err ? 12 : 16, minWidth: 240 }}
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
                  <span
                    style={{ color: 'var(--secondary)' }}
                    title={`Создано ${formatDate(row.createdAt)}`}
                  >
                    {formatDate(row.createdAt)} · {statusLabel(row.status)}
                    {row.usedByEmail ? ` (${row.usedByEmail})` : ''}
                  </span>
                  {row.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => onRevoke(row.id)}
                      disabled={busy}
                      aria-label={`Отозвать приглашение от ${formatDate(row.createdAt)}`}
                      style={{
                        background: 'transparent',
                        color: '#ff8a8a',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: 0,
                        textDecoration: 'underline',
                        textDecorationColor: 'rgba(255,138,138,0.4)',
                        textUnderlineOffset: 3,
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
