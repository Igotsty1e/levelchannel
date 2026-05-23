'use client'

import { useState } from 'react'

import type { AccountProfile } from '@/lib/auth/profiles'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
// Pulling TIMEZONE_OPTIONS from the DB-backed profiles module would
// drag pg into the client bundle (Module not found: 'tls'); use the
// pure constants module instead.
import { TIMEZONE_OPTIONS, safeTimezone } from '@/lib/auth/timezones'

export function ProfileEditor({
  initialProfile,
  fallbackEmail,
}: {
  initialProfile: AccountProfile | null
  fallbackEmail: string
}) {
  // TASK-5 (2026-05-23) — two distinct inputs (firstName + lastName).
  // Storage display_name is recomputed server-side from these two
  // fields. The initial values come from the new mig 0095 columns;
  // back-compat: if both are null but a legacy display_name exists,
  // splitting is server-side already (mig 0095 backfill).
  const [firstName, setFirstName] = useState(initialProfile?.firstName ?? '')
  const [lastName, setLastName] = useState(initialProfile?.lastName ?? '')
  // Default to Europe/Moscow when profile has no tz yet (most learners
  // are RU). The dropdown's options are curated IANA names; saving any
  // other string is now refused server-side. safeTimezone() clamps
  // legacy stored values (e.g. plain 'Moscow') so the dropdown lands
  // on a valid option instead of rendering blank.
  const [timezone, setTimezone] = useState(
    safeTimezone(initialProfile?.timezone),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Live preview of what the saved name will render as.
  const previewName = formatProfileNameForRender({
    firstName,
    lastName,
    displayName: initialProfile?.displayName ?? null,
    fallbackEmail,
  })

  async function onSave() {
    setBusy(true)
    setErr(null)
    setSavedAt(null)
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim() === '' ? null : firstName.trim(),
          lastName: lastName.trim() === '' ? null : lastName.trim(),
          timezone: timezone.trim() === '' ? null : timezone.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErr(data?.message || data?.error || `HTTP ${res.status}`)
      } else {
        setSavedAt(new Date().toLocaleTimeString('ru-RU'))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Профиль
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        Имя нужно, чтобы система обращалась к вам по имени, а не по адресу
        <span style={{ marginLeft: 4, color: 'var(--text)' }}>{fallbackEmail}</span>.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 12,
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
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          marginBottom: 16,
        }}
      >
        Как мы будем к вам обращаться:{' '}
        <span style={{ color: 'var(--text)' }}>{previewName}</span>
      </p>
      <Field label="Часовой пояс">
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={inputStyle}
        >
          {TIMEZONE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
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
    </div>
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
