'use client'

import { useState } from 'react'

type TeacherPackage = {
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
}

// SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher cabinet packages
// editor. Mirrors the admin packages editor shape but targets
// /api/teacher/packages instead of /api/admin/packages.
export function TeacherPackagesEditor({
  initialPackages,
}: {
  initialPackages: TeacherPackage[]
}) {
  const [packages, setPackages] = useState<TeacherPackage[]>(initialPackages)
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
    const r = await fetch('/api/teacher/packages', { cache: 'no-store' })
    if (r.ok) {
      const body = await r.json()
      setPackages(body.packages as TeacherPackage[])
    }
  }

  function deriveSlug(title: string): string {
    // Cabinet polish (2026-05-31) — slug автогенерируется из titleRu,
    // чтобы учитель не возился с техническим полем. Транслит cyrillic
    // → latin + non-alphanumeric → '-' + 8-char random suffix для
    // уникальности.
    const cyr2lat: Record<string, string> = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
      з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
      п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
      ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
      я: 'ya',
    }
    const base = title
      .toLowerCase()
      .split('')
      .map((ch) => cyr2lat[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'pkg'
    const rnd = Math.random().toString(36).slice(2, 10)
    return `${base}-${rnd}`
  }

  async function submitCreate() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const computedSlug = draft.slug.trim() || deriveSlug(draft.titleRu)
      const r = await fetch('/api/teacher/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: computedSlug,
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
        setError(body?.message || body?.error || `HTTP ${r.status}`)
        return
      }
      setInfo(`Создан: ${body.package.slug}`)
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

  async function toggleActive(id: string, nextActive: boolean) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const r = await fetch(`/api/teacher/packages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(body?.message || body?.error || `HTTP ${r.status}`)
        return
      }
      setInfo(
        nextActive
          ? `Пакет ${body.package.slug} активирован`
          : `Пакет ${body.package.slug} архивирован`,
      )
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
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Создать пакет
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <label style={labelStyle}>
            Название (RU)
            <input
              style={inputStyle}
              value={draft.titleRu}
              onChange={(e) =>
                setDraft({ ...draft, titleRu: e.target.value })
              }
              placeholder="Пакет «10 занятий по 60 минут»"
            />
          </label>
          <label style={labelStyle}>
            Длительность (мин)
            <input
              type="number"
              style={inputStyle}
              value={draft.durationMinutes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  durationMinutes: Number(e.target.value),
                })
              }
            />
          </label>
          <label style={labelStyle}>
            Количество уроков
            <input
              type="number"
              style={inputStyle}
              value={draft.count}
              onChange={(e) =>
                setDraft({ ...draft, count: Number(e.target.value) })
              }
            />
          </label>
          <label style={labelStyle}>
            Цена (RUB)
            <input
              type="number"
              style={inputStyle}
              value={draft.amountRub}
              onChange={(e) =>
                setDraft({ ...draft, amountRub: Number(e.target.value) })
              }
            />
          </label>
          <label style={labelStyle}>
            Позиция в списке
            <input
              type="number"
              style={inputStyle}
              value={draft.displayOrder}
              onChange={(e) =>
                setDraft({ ...draft, displayOrder: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label style={{ ...labelStyle, gridColumn: '1 / span 2' }}>
          Описание
          <textarea
            style={{ ...inputStyle, minHeight: 60 }}
            value={draft.descriptionRu}
            onChange={(e) =>
              setDraft({ ...draft, descriptionRu: e.target.value })
            }
          />
        </label>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            disabled={busy}
            onClick={submitCreate}
            style={buttonStyle}
          >
            {busy ? 'Создаю…' : 'Создать пакет'}
          </button>
        </div>
        {error && (
          <p style={{ color: '#ff8a8a', marginTop: 8, fontSize: 13 }}>
            {error}
          </p>
        )}
        {info && (
          <p style={{ color: '#9bdf9b', marginTop: 8, fontSize: 13 }}>
            {info}
          </p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Каталог
        </h2>
        {packages.length === 0 && (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Пока пусто. Создайте первый пакет выше.
          </p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {packages.map((p) => (
            <li
              key={p.id}
              style={{
                padding: 12,
                marginBottom: 8,
                background: p.isActive
                  ? 'rgba(255,255,255,0.03)'
                  : 'rgba(120,120,120,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {p.titleRu}
                </div>
                <div
                  style={{ color: 'var(--secondary)', fontSize: 12, marginTop: 4 }}
                >
                  {p.count} × {p.durationMinutes} мин ·{' '}
                  {(p.amountKopecks / 100).toFixed(2)} {p.currency} ·{' '}
                  {p.isActive ? 'активен' : 'архив'}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => toggleActive(p.id, !p.isActive)}
                style={{
                  ...buttonStyle,
                  background: p.isActive ? '#7a3d3d' : '#3d6f7a',
                }}
              >
                {p.isActive ? 'Архивировать' : 'Активировать'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 13,
  color: 'var(--secondary)',
  gap: 4,
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 14,
  color: 'var(--text)',
}

const buttonStyle: React.CSSProperties = {
  background: '#3d6f7a',
  border: 'none',
  borderRadius: 6,
  padding: '8px 18px',
  color: 'var(--text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}
