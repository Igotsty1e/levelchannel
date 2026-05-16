'use client'

import { useState } from 'react'

type AdminPackage = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  currency: string
  isActive: boolean
  displayOrder: number
  hasPurchases: boolean
}

export function PackagesEditor({
  initialPackages,
}: {
  initialPackages: AdminPackage[]
}) {
  const [packages, setPackages] = useState<AdminPackage[]>(initialPackages)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    slug: '',
    titleRu: '',
    descriptionRu: '',
    durationMinutes: 60,
    count: 10,
    amountRub: 35000,
    displayOrder: 100,
  })

  async function refresh() {
    const r = await fetch('/api/admin/packages', { cache: 'no-store' })
    if (r.ok) {
      const body = await r.json()
      setPackages(
        body.packages.map((p: AdminPackage) => ({
          ...p,
          // reconstruct hasPurchases by re-querying — out of scope here,
          // assume hasPurchases stays the same as server reports.
          hasPurchases:
            packages.find((existing) => existing.id === p.id)?.hasPurchases ?? false,
        })),
      )
    }
  }

  async function submitCreate() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const r = await fetch('/api/admin/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: draft.slug.trim(),
          titleRu: draft.titleRu.trim(),
          descriptionRu: draft.descriptionRu.trim() || null,
          durationMinutes: Number(draft.durationMinutes),
          count: Number(draft.count),
          amountKopecks: Math.round(Number(draft.amountRub) * 100),
          displayOrder: Number(draft.displayOrder),
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(body?.message || body?.error || `HTTP `)
        return
      }
      setInfo(`Создано: ${body.package.slug}`)
      setDraft({
        slug: '',
        titleRu: '',
        descriptionRu: '',
        durationMinutes: 60,
        count: 10,
        amountRub: 35000,
        displayOrder: 100,
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section
        style={{
          padding: 16,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Создать пакет
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="Slug">
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="package-10x60min"
              style={inputStyle}
            />
          </Field>
          <Field label="Название (ru)">
            <input
              type="text"
              value={draft.titleRu}
              onChange={(e) => setDraft({ ...draft, titleRu: e.target.value })}
              placeholder="10 уроков по 60 мин"
              style={inputStyle}
            />
          </Field>
          <Field label="Длительность (мин)">
            <input
              type="number"
              min={15}
              max={180}
              value={draft.durationMinutes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  durationMinutes: Number(e.target.value),
                })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="Уроков в пакете">
            <input
              type="number"
              min={1}
              max={100}
              value={draft.count}
              onChange={(e) =>
                setDraft({ ...draft, count: Number(e.target.value) })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="Цена (₽)">
            <input
              type="number"
              min={1}
              max={1000000}
              value={draft.amountRub}
              onChange={(e) =>
                setDraft({ ...draft, amountRub: Number(e.target.value) })
              }
              style={inputStyle}
            />
          </Field>
          <Field
            label="Порядок (для каталога)"
            hint="Меньшее число — выше в каталоге пакетов у ученика. На цену и состав пакета не влияет."
          >
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) =>
                setDraft({ ...draft, displayOrder: Number(e.target.value) })
              }
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Описание (опционально)">
          <input
            type="text"
            value={draft.descriptionRu}
            onChange={(e) =>
              setDraft({ ...draft, descriptionRu: e.target.value })
            }
            style={{ ...inputStyle, width: '100%' }}
          />
        </Field>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={submitCreate}
            disabled={busy}
            style={{
              padding: '8px 16px',
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Создаём…' : 'Создать пакет'}
          </button>
        </div>
        {info ? (
          <p style={{ color: '#9bdf9b', fontSize: 13, marginTop: 8 }}>{info}</p>
        ) : null}
        {error ? (
          <p style={{ color: '#ff8a8a', fontSize: 13, marginTop: 8 }}>{error}</p>
        ) : null}
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Каталог
        </h2>
        {packages.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            Пакетов нет.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {packages.map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 14,
                  opacity: p.isActive ? 1 : 0.5,
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{p.titleRu}</strong>{' '}
                  <span style={{ color: 'var(--secondary)' }}>
                    ({p.slug})
                  </span>
                  <div style={{ color: 'var(--secondary)', fontSize: 12 }}>
                    {p.count}×{p.durationMinutes} мин ·{' '}
                    {Math.round(p.amountKopecks / 100).toLocaleString('ru-RU')} ₽ ·
                    порядок {p.displayOrder}
                    {p.hasPurchases ? (
                      <>
                        {' '}
                        ·{' '}
                        <span style={{ color: '#fbbf24' }}>
                          цена/длительность зафиксированы
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: p.isActive ? '#9bdf9b' : '#ff8a8a' }}>
                    {p.isActive ? 'активен' : 'архив'}
                  </span>
                  {/* PKG-ADMIN-GRANT LBL.2 — inline grant action.
                      Only visible on active packages — admin-grant
                      route refuses inactive with 422 package_inactive,
                      so hiding the button keeps the UI honest. */}
                  {p.isActive ? <GrantButton pkg={p} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 12,
          color: 'var(--secondary)',
          cursor: hint ? 'help' : undefined,
        }}
        title={hint}
      >
        {label}
        {hint ? (
          <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.7 }}>
            ⓘ
          </span>
        ) : null}
      </span>
      {children}
    </label>
  )
}

// PKG-ADMIN-GRANT LBL.2 — inline grant action per package row.
//
// Calls POST /api/admin/packages/[id]/grant. Each click generates a
// FRESH Idempotency-Key (round-5 WARN #2 — same key replays cached
// response; fresh key per intentional grant). For stacked grants
// (allowStacking=true), operator must give a fresh key OR the cached
// response from the prior submit replays.
//
// UI shape: button → 3 native prompt()s for {targetAccountId, reason,
// allowStacking?}. Mirrors PKG-RECON actions-cell.tsx pattern (also
// native prompts — see app/admin/(gated)/reconciliation/actions-cell.tsx).
// Modal-based pickers are a follow-up wave when we extract a reusable
// learner-archetype account picker.
function GrantButton({ pkg }: { pkg: AdminPackage }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onClick() {
    setErr(null)
    setDone(null)
    const targetAccountId = window.prompt(
      'UUID аккаунта ученика (target):',
      '',
    )
    if (!targetAccountId) return
    const reason = window.prompt(
      'Причина выдачи (durable, попадает в payment_orders.description):',
      '',
    )
    if (reason === null || !reason.trim()) {
      setErr('Reason required.')
      return
    }
    const allowStacking = window.confirm(
      'Разрешить стекать с существующим активным пакетом той же длительности? OK = да, Cancel = нет.',
    )
    setBusy(true)
    try {
      const res = await fetch(
        `/api/admin/packages/${encodeURIComponent(pkg.id)}/grant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': freshIdempotencyKey(),
          },
          body: JSON.stringify({
            targetAccountId: targetAccountId.trim(),
            reason: reason.trim(),
            allowStacking,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      setDone(
        `Выдан: ${json.titleSnapshot} (${json.count} шт), истекает ${
          json.expiresAt ? new Date(json.expiresAt).toLocaleDateString('ru-RU') : '—'
        }`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 600,
          background: busy ? 'rgba(255,255,255,0.05)' : 'var(--accent, #5b8ef7)',
          color: busy ? 'var(--secondary)' : 'var(--accent-contrast, #fff)',
          border: 'none',
          borderRadius: 4,
          cursor: busy ? 'wait' : 'pointer',
        }}
        title={`Выдать "${pkg.titleRu}" ученику бесплатно (compensation/comp).`}
      >
        {busy ? '…' : 'Выдать ученику'}
      </button>
      {done ? (
        <span style={{ color: '#9bdf9b', fontSize: 11, maxWidth: 280, textAlign: 'right' }}>
          ✓ {done}
        </span>
      ) : null}
      {err ? (
        <span style={{ color: '#ff8a8a', fontSize: 11, maxWidth: 280, textAlign: 'right' }}>
          {err}
        </span>
      ) : null}
    </div>
  )
}

function freshIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  fontSize: 13,
}
