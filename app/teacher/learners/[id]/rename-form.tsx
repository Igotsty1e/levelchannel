'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// SAAS-PIVOT — teacher renames learner client form.
//
// Plan: owner-requested 2026-05-23.
//
// TASK-5 (mig 0095) — firstName + lastName inputs replace the single
// `displayName` field. Both optional; null clears. Email separately.
// POSTs to `/api/teacher/learners/[id]/rename`.
//
// Client-side validation is a HINT only — the route is the authority.
// We surface server-side errors verbatim via `data.message`.

export function RenameLearnerForm({
  learnerId,
  initialFirstName,
  initialLastName,
  initialEmail,
}: {
  learnerId: string
  initialFirstName: string
  initialLastName: string
  initialEmail: string
}) {
  const router = useRouter()
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const dirtyFirstName = firstName.trim() !== initialFirstName.trim()
  const dirtyLastName = lastName.trim() !== initialLastName.trim()
  const dirtyEmail = email.trim().toLowerCase() !== initialEmail.trim().toLowerCase()
  const canSave = (dirtyFirstName || dirtyLastName || dirtyEmail) && !busy

  // Soft client-side hint regex — server has the authoritative check.
  const emailLooksOk = !dirtyEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    setErr(null)
    setSavedAt(null)
    try {
      const body: Record<string, string | null> = {}
      if (dirtyFirstName) {
        body.firstName = firstName.trim() === '' ? null : firstName.trim()
      }
      if (dirtyLastName) {
        body.lastName = lastName.trim() === '' ? null : lastName.trim()
      }
      if (dirtyEmail) body.email = email.trim()
      const res = await fetch(`/api/teacher/learners/${learnerId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string }
        | null
      if (!res.ok || !data?.ok) {
        setErr(data?.message || data?.error || `HTTP ${res.status}`)
      } else {
        setSavedAt(new Date().toLocaleTimeString('ru-RU'))
        // Server-side data drives the header (display_name + email). Refresh
        // so the page picks up the new values without a manual reload.
        router.refresh()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      style={{
        padding: 16,
        background: 'var(--surface)',
        borderRadius: 8,
        marginBottom: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Изменить данные ученика
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        Меняет имя и/или email только для этого ученика. Пароль и другие
        данные ученик меняет в своём личном кабинете самостоятельно.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <Field label="Имя">
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Иван"
            style={inputStyle}
            maxLength={60}
          />
        </Field>
        <Field label="Фамилия">
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Петров"
            style={inputStyle}
            maxLength={60}
          />
        </Field>
      </div>
      <Field label="Email">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="learner@example.com"
          style={{
            ...inputStyle,
            borderColor: emailLooksOk ? 'var(--border)' : '#ff8a8a',
          }}
          type="email"
          autoComplete="off"
        />
        {!emailLooksOk && (
          <span style={{ color: '#ff8a8a', fontSize: 12, marginTop: 4, display: 'block' }}>
            Похоже на неверный email.
          </span>
        )}
      </Field>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast, var(--accent-fg))',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.55,
          }}
        >
          Сохранить
        </button>
        {savedAt ? (
          <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Сохранено в {savedAt}
          </span>
        ) : null}
        {err ? (
          <span style={{ color: '#ff8a8a', fontSize: 13 }}>{err}</span>
        ) : null}
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        style={{
          display: 'block',
          color: 'var(--secondary)',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
}
