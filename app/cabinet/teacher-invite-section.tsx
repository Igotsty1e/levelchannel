'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Checkbox, CollapsibleCard } from '@/components/ui/primitives'
import { postAuthJson } from '@/lib/auth/client'
import type { TeacherPlanLearnerLimit } from '@/lib/onboarding/teacher-plan-limit'

// SAAS-4 TINV.5 (2026-05-18) — teacher's invite-generation card.
//
// Renders disabled placeholder when !isVerified (round-2 WARN#9): the
// active controls (POST /api/teacher/invites) require requireTeacher-
// AndVerified server-side. Showing a clickable button that 403s is
// worse than showing the gated state explicitly.

export type InviteTariffOption = {
  id: string
  titleRu: string
  amountKopecks: number
  durationMinutes: number
}

export type InvitePackageOption = {
  id: string
  titleRu: string
  count: number
  durationMinutes: number
  amountKopecks: number
}

type Props = {
  isVerified: boolean
  planLearnerLimit?: TeacherPlanLearnerLimit
  /** Активные тарифы учителя (filtered + scoped server-side). Если
   *  пусто — multi-select тарифов скрыт целиком. */
  availableTariffs?: ReadonlyArray<InviteTariffOption>
  /** Активные пакеты учителя. Если пусто — multi-select пакетов скрыт. */
  availablePackages?: ReadonlyArray<InvitePackageOption>
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
  // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
  defaultPaymentMethod?: 'postpaid' | 'none'
  defaultTariffIds?: ReadonlyArray<string>
  defaultPackageIds?: ReadonlyArray<string>
}

type DefaultPaymentMethod = 'none' | 'postpaid'

// 2026-06-12 (Задача 1): PAYMENT_METHOD_OPTIONS убран — заменено
// одним чекбоксом «Активный ученик» (active=true → 'postpaid',
// false → 'none'). См. <Checkbox> в render ниже.

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

export function TeacherInviteSection({
  isVerified,
  planLearnerLimit,
  availableTariffs = [],
  availablePackages = [],
}: Props) {
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
  // 2026-06-12 (Задача 1): «Активный ученик» — по умолчанию включён.
  // active=true → defaultPaymentMethod='postpaid' (может бронировать).
  // active=false → 'none' (ученик «спящий», бронирование заблокировано).
  const [active, setActive] = useState<boolean>(true)
  const [selectedTariffIds, setSelectedTariffIds] = useState<Set<string>>(
    new Set(),
  )
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<string>>(
    new Set(),
  )
  function toggleTariff(id: string) {
    setSelectedTariffIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function togglePackage(id: string) {
    setSelectedPackageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
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
      defaultPaymentMethod: active ? 'postpaid' : 'none',
      defaultTariffIds: Array.from(selectedTariffIds),
      defaultPackageIds: Array.from(selectedPackageIds),
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
    setSelectedTariffIds(new Set())
    setSelectedPackageIds(new Set())
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

  const activeInviteCount = invites.filter((i) => i.status === 'active').length
  const headerMeta = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {activeInviteCount > 0 ? (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'rgba(110, 168, 254, 0.14)',
            color: 'var(--accent, #6ea8fe)',
          }}
        >
          {activeInviteCount} активных
        </span>
      ) : null}
      {limited ? (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 8px',
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
          {limited.activeCount}/{limited.limit}
        </span>
      ) : null}
    </span>
  )

  return (
    <CollapsibleCard
      title="Пригласить ученика"
      defaultOpen={false}
      meta={headerMeta}
      description="Создать ссылку для нового ученика и сразу открыть доступ к тарифам и пакетам"
    >
      {isHardLimit ? (
        <div style={{ marginBottom: 12 }}>
          <Link
            href="/teacher/subscription"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 14px',
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
        </div>
      ) : null}
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
        <Checkbox
          checked={active}
          onChange={setActive}
          disabled={busy}
          label="Активный ученик"
          hint="Может бронировать слоты и тратить пакеты"
        />
        {!active ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 10,
            }}
          >
            Без галочки ученик не сможет записаться к вам, пока вы не активируете
            его на карточке ученика.
          </p>
        ) : null}
      </div>
      {availableTariffs.length > 0 ? (
        <InviteMultiSelect
          legend="Открыть тарифы"
          hint="Ученик сразу увидит выбранные тарифы в своём кабинете и сможет бронировать."
          options={availableTariffs.map((t) => ({
            id: t.id,
            label: t.titleRu,
            sub: `${t.durationMinutes} мин · ${formatRub(t.amountKopecks)}`,
          }))}
          selected={selectedTariffIds}
          onToggle={toggleTariff}
          disabled={busy}
        />
      ) : null}
      {availablePackages.length > 0 ? (
        <InviteMultiSelect
          legend="Открыть пакеты"
          hint="Ученик сможет купить выбранные пакеты со скидкой за объём."
          options={availablePackages.map((p) => ({
            id: p.id,
            label: p.titleRu,
            sub: `${p.count} занятий · ${p.durationMinutes} мин · ${formatRub(p.amountKopecks)}`,
          }))}
          selected={selectedPackageIds}
          onToggle={togglePackage}
          disabled={busy}
        />
      ) : null}
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
    </CollapsibleCard>
  )
}

function formatRub(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString('ru-RU')} ₽`
}

function InviteMultiSelect({
  legend,
  hint,
  options,
  selected,
  onToggle,
  disabled,
}: {
  legend: string
  hint: string
  options: ReadonlyArray<{ id: string; label: string; sub: string }>
  selected: Set<string>
  onToggle: (id: string) => void
  disabled: boolean
}) {
  return (
    <fieldset
      style={{
        border: 'none',
        padding: 0,
        margin: '0 0 16px',
      }}
    >
      <legend
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
          color: 'var(--text)',
        }}
      >
        {legend} <span style={{ color: 'var(--secondary)', fontWeight: 400 }}>(необязательно)</span>
      </legend>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          margin: '0 0 8px',
          lineHeight: 1.4,
        }}
      >
        {hint}
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 220,
          overflowY: 'auto',
          padding: 6,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        {options.map((opt) => {
          const active = selected.has(opt.id)
          return (
            <label
              key={opt.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                background: active
                  ? 'rgba(110, 168, 254, 0.12)'
                  : 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => onToggle(opt.id)}
                disabled={disabled}
                style={{ margin: 0 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span
                  style={{
                    color: 'var(--text)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.label}
                </span>
                <span style={{ color: 'var(--secondary)', fontSize: 12 }}>{opt.sub}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
