'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// SAAS-PIVOT Epic 6 Day 6 — admin edit form for a teacher: plan_slug
// + teacher_public_slug. Two separate POSTs to keep the API surfaces
// orthogonal (a plan-toggle audit-row should be independent of a slug
// rename).

// bug-4 Sub-PR A (2026-06-02): admin options carry both the new public
// Russian title AND the canonical DB slug (matching PLAN_LABEL in
// app/admin/(gated)/teachers/page.tsx). operator-managed stays untouched.
const PLAN_OPTIONS = [
  { slug: 'free', label: 'Стартовый (free)' },
  { slug: 'mid', label: 'Базовый (mid)' },
  { slug: 'pro', label: 'Расширенный (pro)' },
  { slug: 'operator-managed', label: 'Operator-managed (operator-managed)' },
]

export function TeacherEditForm({
  teacherAccountId,
  currentPlanSlug,
  currentSlug,
}: {
  teacherAccountId: string
  currentPlanSlug: string
  currentSlug: string
}) {
  const router = useRouter()
  const [planSlug, setPlanSlug] = useState(currentPlanSlug)
  const [slug, setSlug] = useState(currentSlug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState<string | null>(null)

  async function postPlan() {
    setBusy(true)
    setError(null)
    setOkFlash(null)
    try {
      const resp = await fetch(
        `/api/admin/teachers/${encodeURIComponent(teacherAccountId)}/plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planSlug }),
        },
      )
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(body.message ?? body.error ?? 'Не удалось обновить тариф.')
        return
      }
      setOkFlash('Тариф обновлён.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function postSlug() {
    setBusy(true)
    setError(null)
    setOkFlash(null)
    try {
      const resp = await fetch(
        `/api/admin/teachers/${encodeURIComponent(teacherAccountId)}/slug`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: slug.trim() || null }),
        },
      )
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(body.message ?? body.error ?? 'Не удалось обновить slug.')
        return
      }
      setOkFlash('Slug обновлён.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 120, color: 'var(--secondary)', fontSize: 13 }}>
          Тариф
        </span>
        <select
          value={planSlug}
          onChange={(e) => setPlanSlug(e.target.value)}
          disabled={busy}
          style={selectStyle}
        >
          {PLAN_OPTIONS.map((opt) => (
            <option key={opt.slug} value={opt.slug}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={postPlan}
          disabled={busy || planSlug === currentPlanSlug}
          style={primaryBtn}
        >
          Сохранить тариф
        </button>
      </label>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 120, color: 'var(--secondary)', fontSize: 13 }}>
          Public slug
        </span>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={busy}
          placeholder="например: ivan"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={postSlug}
          disabled={busy || slug.trim() === currentSlug}
          style={primaryBtn}
        >
          Сохранить slug
        </button>
      </label>
      {error ? (
        <p style={{ color: '#ff7676', fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}
      {okFlash ? (
        <p style={{ color: '#5ddc70', fontSize: 13, margin: 0 }}>{okFlash}</p>
      ) : null}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
  minWidth: 200,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
}
