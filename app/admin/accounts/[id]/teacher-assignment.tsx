'use client'

import { useState } from 'react'

type Teacher = { id: string; email: string }

type Props = {
  accountId: string
  currentTeacherId: string | null
  teachers: Teacher[]
}

export function TeacherAssignment({
  accountId,
  currentTeacherId,
  teachers,
}: Props) {
  const [selected, setSelected] = useState<string>(currentTeacherId ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/teacher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherAccountId: selected || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      setInfo(selected ? 'Учитель назначен.' : 'Учитель отвязан.')
    } finally {
      setBusy(false)
    }
  }

  if (teachers.length === 0) {
    return (
      <p style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.6 }}>
        Нет аккаунтов с ролью <code>teacher</code>. Сначала выдайте роль{' '}
        <code>teacher</code> подходящему аккаунту в этом списке.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        Учащийся видит только свободные слоты назначенного учителя. Без
        привязки в кабинете показывается «учитель не назначен».
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            color: 'var(--text)',
            fontSize: 13,
            minWidth: 240,
          }}
        >
          <option value="">— без учителя —</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.email}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Сохранить
        </button>
        {info ? (
          <span style={{ color: '#9bdf9b', fontSize: 12 }}>{info}</span>
        ) : null}
        {err ? <span style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</span> : null}
      </div>
    </div>
  )
}
