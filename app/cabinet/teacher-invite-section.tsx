'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PackageCreateSheet } from '@/components/teacher/pricing/package-create-sheet'
import { TariffCreateSheet } from '@/components/teacher/pricing/tariff-create-sheet'
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

      {/* Задача 2 (2026-06-12): «Настроить тип оплаты» — вложенный
          раскрывающийся блок. Обязателен при active=true (нужен хотя бы
          один тариф или пакет, иначе ученик не сможет бронировать).
          Если active=false — блок не обязателен, и подсказка явно
          говорит об этом. Открыт по умолчанию когда active=true. */}
      <PaymentSetupSection
        active={active}
        availableTariffs={availableTariffs}
        availablePackages={availablePackages}
        selectedTariffIds={selectedTariffIds}
        selectedPackageIds={selectedPackageIds}
        onToggleTariff={toggleTariff}
        onTogglePackage={togglePackage}
        disabled={busy}
      />
      {(() => {
        // Задача 2 (2026-06-12): обязательное поле «Настроить тип оплаты»
        // если ученик активный — иначе ученик не сможет бронировать.
        // disable submit + видимый hint снизу.
        const needsPayment
          = active
            && selectedTariffIds.size === 0
            && selectedPackageIds.size === 0
        const submitTitle = isHardLimit
          ? `Достигнут лимит ${limited!.activeCount}/${limited!.limit} учеников. Обновите тариф.`
          : needsPayment
            ? 'Выберите тариф или пакет — без этого активный ученик не сможет бронировать.'
            : undefined
        return (
          <>
            <button
              type="button"
              onClick={onGenerate}
              disabled={busy || isHardLimit || needsPayment}
              className="btn-primary"
              title={submitTitle}
              style={{ marginBottom: err || needsPayment ? 8 : 16, minWidth: 240 }}
            >
              {busy ? 'Создаём…' : 'Создать ссылку-приглашение'}
            </button>
            {needsPayment ? (
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginBottom: 16,
                }}
              >
                Выберите хотя бы один тариф или пакет в блоке «Настроить тип
                оплаты» — без этого активный ученик не сможет бронировать.
              </p>
            ) : null}
          </>
        )
      })()}
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

// Задача 2 (2026-06-12): «Настроить тип оплаты» — вложенный
// раскрывающийся блок внутри инвайта.
function PaymentSetupSection({
  active,
  availableTariffs,
  availablePackages,
  selectedTariffIds,
  selectedPackageIds,
  onToggleTariff,
  onTogglePackage,
  disabled,
}: {
  active: boolean
  availableTariffs: ReadonlyArray<InviteTariffOption>
  availablePackages: ReadonlyArray<InvitePackageOption>
  selectedTariffIds: Set<string>
  selectedPackageIds: Set<string>
  onToggleTariff: (id: string) => void
  onTogglePackage: (id: string) => void
  disabled: boolean
}) {
  const router = useRouter()
  const [openCreateTariff, setOpenCreateTariff] = useState(false)
  const [openCreatePackage, setOpenCreatePackage] = useState(false)

  async function apiCreateTariff(input: {
    titleRu: string
    amountKopecks: number
    durationMinutes: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch('/api/teacher/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, isActive: true, displayOrder: 0 }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        return {
          ok: false,
          message: data?.message || data?.error || `HTTP ${res.status}`,
        }
      }
      setOpenCreateTariff(false)
      // SSR подхватит новый тариф через свежую загрузку списка
      // (page.tsx — server component).
      router.refresh()
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'network',
      }
    }
  }

  async function apiCreatePackage(input: {
    titleRu: string
    descriptionRu: string | null
    durationMinutes: number
    count: number
    amountKopecks: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch('/api/teacher/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, isActive: true, displayOrder: 0 }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        return {
          ok: false,
          message: data?.message || data?.error || `HTTP ${res.status}`,
        }
      }
      setOpenCreatePackage(false)
      router.refresh()
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'network',
      }
    }
  }

  return (
    <>
      <CollapsibleCard
        title="Настроить тип оплаты"
        description="Выберите один или несколько вариантов"
        defaultOpen={false}
      >
        <InviteMultiGroup
          title="Установить тариф"
          hint="Ученик сможет бронировать слоты с выбранными тарифами."
          options={availableTariffs.map((t) => ({
            id: t.id,
            label: t.titleRu,
            sub: `${t.durationMinutes} мин · ${formatRub(t.amountKopecks)}`,
          }))}
          selected={selectedTariffIds}
          onToggle={onToggleTariff}
          disabled={disabled}
          createLabel="+ Создать тариф"
          onCreate={() => setOpenCreateTariff(true)}
        />
        <div style={{ height: 16 }} />
        <InviteMultiGroup
          title="Выдать пакет занятий"
          hint="Ученик сможет использовать предоплаченные занятия."
          options={availablePackages.map((p) => ({
            id: p.id,
            label: p.titleRu,
            sub: `${p.count} занятий · ${p.durationMinutes} мин · ${formatRub(p.amountKopecks)}`,
          }))}
          selected={selectedPackageIds}
          onToggle={onTogglePackage}
          disabled={disabled}
          createLabel="+ Создать пакет"
          onCreate={() => setOpenCreatePackage(true)}
        />
      </CollapsibleCard>

      {openCreateTariff ? (
        <TariffCreateSheet
          onClose={() => setOpenCreateTariff(false)}
          onCreate={apiCreateTariff}
        />
      ) : null}
      {openCreatePackage ? (
        <PackageCreateSheet
          onClose={() => setOpenCreatePackage(false)}
          onCreate={apiCreatePackage}
        />
      ) : null}
    </>
  )
}

function InviteMultiGroup({
  title,
  hint,
  options,
  selected,
  onToggle,
  disabled,
  createLabel,
  onCreate,
}: {
  title: string
  hint: string
  options: ReadonlyArray<{ id: string; label: string; sub: string }>
  selected: Set<string>
  onToggle: (id: string) => void
  disabled: boolean
  createLabel: string
  onCreate: () => void
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>
        {title}
      </div>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          margin: '4px 0 8px',
          lineHeight: 1.45,
        }}
      >
        {hint}
      </p>
      {options.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 220,
            overflowY: 'auto',
            padding: 6,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {options.map((opt) => {
            const isOn = selected.has(opt.id)
            return (
              <label
                key={opt.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px',
                  borderRadius: 6,
                  background: isOn ? 'var(--accent-bg)' : 'transparent',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'background 120ms ease-out',
                }}
              >
                <Checkbox
                  checked={isOn}
                  onChange={() => onToggle(opt.id)}
                  disabled={disabled}
                  label={
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
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
                      <span style={{ color: 'var(--secondary)', fontSize: 12, fontWeight: 400 }}>
                        {opt.sub}
                      </span>
                    </span>
                  }
                />
              </label>
            )
          })}
        </div>
      ) : (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 12,
            margin: '0 0 8px',
            lineHeight: 1.45,
            fontStyle: 'italic',
          }}
        >
          Пока ничего не создано.
        </p>
      )}
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          padding: '10px 14px',
          border: '1px dashed var(--border)',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--accent, #D88A82)',
          fontSize: 13,
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {createLabel}
      </button>
    </div>
  )
}
