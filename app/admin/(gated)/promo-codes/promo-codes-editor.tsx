'use client'

import { FormEvent, useState } from 'react'

type PromoRow = {
  id: string
  code: string
  description: string | null
  grantPlanSlug: string
  grantDays: number
  maxRedemptions: number | null
  redemptionCount: number
  validFrom: string
  validUntil: string | null
  createdAt: string
  revokedAt: string | null
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Стартовый',
  mid: 'Базовый',
  pro: 'Расширенный',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}

export function PromoCodesEditor({ initial }: { initial: PromoRow[] }) {
  const [rows, setRows] = useState<PromoRow[]>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [grantDays, setGrantDays] = useState('90')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [validUntil, setValidUntil] = useState('')

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          description: description.trim() || null,
          grantPlanSlug: 'pro',
          grantDays: Number(grantDays),
          maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
          validUntil: validUntil.trim() || null,
          requiresEmailVerified: true,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const row = (await res.json()) as PromoRow
      setRows([row, ...rows])
      setCode('')
      setDescription('')
      setMaxRedemptions('')
      setValidUntil('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  async function onRevoke(id: string) {
    const reason = window.prompt('Причина отзыва?')
    if (!reason) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRows(
        rows.map((r) => (r.id === id ? { ...r, revokedAt: new Date().toISOString() } : r)),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'revoke_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <form
        onSubmit={onCreate}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Создать промокод</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Код
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="LAUNCH3"
              maxLength={32}
              pattern="[A-Za-z0-9_\-]{3,32}"
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Описание
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Запуск 2026-06"
              maxLength={200}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Дней действия
            <input
              type="number"
              value={grantDays}
              onChange={(e) => setGrantDays(e.target.value)}
              required
              min={1}
              max={365}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Лимит выдач
            <input
              type="number"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="(без лимита)"
              min={1}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
            Действует до
            <input
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--secondary)' }}>
          Тариф: Расширенный (pro) — на MVP создаём только pro.
        </div>
        {err ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Ошибка: {err}</div>
        ) : null}
        <div>
          <button type="submit" disabled={busy} style={btnStyle}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </form>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--card)' }}>
              <th style={thStyle}>Код</th>
              <th style={thStyle}>Тариф</th>
              <th style={thStyle}>Дней</th>
              <th style={thStyle}>Выдано / лимит</th>
              <th style={thStyle}>Создан</th>
              <th style={thStyle}>Истекает</th>
              <th style={thStyle}>Статус</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--secondary)' }}>
                  Промокодов пока нет.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 12 }}>{r.code}</code>
                    {r.description ? (
                      <div style={{ color: 'var(--secondary)', fontSize: 11, marginTop: 2 }}>
                        {r.description}
                      </div>
                    ) : null}
                  </td>
                  <td style={tdStyle}>{PLAN_LABELS[r.grantPlanSlug] ?? r.grantPlanSlug}</td>
                  <td style={tdStyle}>{r.grantDays}</td>
                  <td style={tdStyle}>
                    {r.redemptionCount} / {r.maxRedemptions ?? '∞'}
                  </td>
                  <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                  <td style={tdStyle}>{fmtDate(r.validUntil)}</td>
                  <td style={tdStyle}>
                    {r.revokedAt ? (
                      <span style={{ color: 'var(--danger)' }}>отозван</span>
                    ) : (
                      <span style={{ color: 'var(--success, #4ade80)' }}>активен</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.revokedAt ? null : (
                      <button
                        type="button"
                        onClick={() => onRevoke(r.id)}
                        disabled={busy}
                        style={btnSecondaryStyle}
                      >
                        Отозвать
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
}

const btnStyle = {
  display: 'inline-block',
  padding: '8px 16px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
}

const btnSecondaryStyle = {
  padding: '4px 10px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
}

const thStyle = {
  padding: '10px 12px',
  textAlign: 'left' as const,
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--secondary)',
}

const tdStyle = {
  padding: '10px 12px',
  verticalAlign: 'top' as const,
}
