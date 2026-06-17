'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/primitives'

type Props = {
  initialMinutes: number
}

function minutesToHMm(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

export function CancelPolicyForm({ initialMinutes }: Props) {
  const initial = minutesToHMm(initialMinutes)
  const [hours, setHours] = useState(initial.hours)
  const [mins, setMins] = useState(initial.minutes)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const totalMinutes = Math.max(0, Math.min(48 * 60, hours * 60 + mins))

  async function save() {
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/cancel-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: totalMinutes }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.message ?? 'Не удалось сохранить.')
        return
      }
      setMsg('Сохранено.')
    } finally {
      setSaving(false)
    }
  }

  const friendlyText =
    totalMinutes === 0
      ? 'Можно отменять без ограничений (даже за 1 минуту до начала).'
      : `Можно отменять не позже чем за ${formatRu(totalMinutes)} до начала.`

  return (
    <section
      className="card"
      style={{ padding: 24, marginBottom: 16 }}
      aria-label="Окно отмены"
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: 12,
        }}
      >
        <label style={fieldStyle}>
          <span style={labelStyle}>Часы (0-48)</span>
          <input
            type="number"
            min={0}
            max={48}
            step={1}
            value={hours}
            onChange={(e) =>
              setHours(Math.max(0, Math.min(48, parseInt(e.target.value || '0', 10) || 0)))
            }
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Минуты (0-59)</span>
          <input
            type="number"
            min={0}
            max={59}
            step={1}
            value={mins}
            onChange={(e) =>
              setMins(Math.max(0, Math.min(59, parseInt(e.target.value || '0', 10) || 0)))
            }
            style={inputStyle}
          />
        </label>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </div>
      <p style={{ color: 'var(--secondary)', fontSize: 13, margin: 0 }}>
        {friendlyText}
      </p>
      {msg ? (
        <p style={{ color: '#9bdf9b', fontSize: 13, marginTop: 8 }}>{msg}</p>
      ) : null}
      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</p>
      ) : null}
    </section>
  )
}

function formatRu(totalMinutes: number): string {
  const { hours, minutes } = minutesToHMm(totalMinutes)
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ч`)
  if (minutes > 0) parts.push(`${minutes} мин`)
  return parts.join(' ') || '0 мин'
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
  fontWeight: 500,
}
const inputStyle: React.CSSProperties = {
  width: 80,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums',
}
