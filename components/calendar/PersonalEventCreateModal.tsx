'use client'

// Epic B (2026-06-19) — модалка «Новое дело». title + body + старт-время
// + длительность. POST /api/teacher/personal-events.

import { useEffect, useState } from 'react'

const MAX_TITLE = 80
const MAX_BODY = 2000

// MSK helpers — собираем ISO из локальных «YYYY-MM-DDTHH:MM» полей.
function toIsoStartOrNull(localValue: string): string | null {
  if (!localValue) return null
  const ms = Date.parse(localValue + ':00Z') // обрабатываем как UTC; ниже даём подсказку «по МСК»
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

export function PersonalEventCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [startLocal, setStartLocal] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit() {
    const startAt = toIsoStartOrNull(startLocal)
    if (!startAt) {
      setErr('Укажите время начала.')
      return
    }
    const t = title.trim()
    if (t.length === 0) {
      setErr('Введите название дела.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/personal-events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startAt,
          durationMinutes,
          title: t,
          body: body.trim().length > 0 ? body.trim() : null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      if (!res.ok) {
        setErr(data?.message ?? `Ошибка: ${data?.error ?? res.status}`)
        return
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать дело.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" style={scrimStyle} data-testid="personal-event-create-modal">
      <div style={cardStyle}>
        <h3 style={titleStyle}>Новое дело</h3>
        <p style={subStyle}>
          Слот будет заблокирован для брони. Ученики дело не видят.
        </p>

        <div style={fieldStyle}>
          <label style={labelStyle}>Начало (МСК)</label>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            disabled={busy}
            style={inputStyle}
            data-testid="personal-event-start-input"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Длительность</label>
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            disabled={busy}
            style={inputStyle}
            data-testid="personal-event-duration-input"
          >
            <option value={15}>15 минут</option>
            <option value={30}>30 минут</option>
            <option value={45}>45 минут</option>
            <option value={60}>1 час</option>
            <option value={90}>1.5 часа</option>
            <option value={120}>2 часа</option>
            <option value={180}>3 часа</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Название</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            maxLength={MAX_TITLE}
            disabled={busy}
            style={inputStyle}
            placeholder="Например: стоматолог"
            data-testid="personal-event-title-input"
          />
          <div style={counterStyle}>
            {title.length} / {MAX_TITLE}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>
            Заметка <span style={optStyle}>— по желанию</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
            disabled={busy}
            rows={4}
            style={textareaStyle}
            placeholder="Адрес, контакты, что-то ещё что важно помнить"
            data-testid="personal-event-body-input"
          />
          <div style={counterStyle}>
            {body.length} / {MAX_BODY}
          </div>
        </div>

        {err ? <p style={errStyle}>{err}</p> : null}

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={ghostBtnStyle}
            data-testid="personal-event-cancel-btn"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={primaryBtnStyle}
            data-testid="personal-event-submit-btn"
          >
            {busy ? 'Сохраняем…' : 'Создать дело'}
          </button>
        </div>
      </div>
    </div>
  )
}

const scrimStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1, #141416)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 24,
  maxWidth: 480,
  width: '100%',
  boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--text)',
}

const subStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 13,
  marginTop: 6,
  marginBottom: 18,
  lineHeight: 1.5,
}

const fieldStyle: React.CSSProperties = { marginBottom: 14 }

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--secondary)',
  marginBottom: 6,
}

const optStyle: React.CSSProperties = {
  color: 'var(--text-tertiary, var(--secondary))',
  marginLeft: 4,
  fontWeight: 400,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2, #1c1c1f)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '10px 12px',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 80,
  lineHeight: 1.5,
}

const counterStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary, var(--secondary))',
  textAlign: 'right',
  marginTop: 4,
}

const errStyle: React.CSSProperties = {
  color: 'var(--danger)',
  fontSize: 13,
  marginBottom: 12,
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 18,
}

const btnBaseStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  border: 0,
}

const primaryBtnStyle: React.CSSProperties = {
  ...btnBaseStyle,
  background: 'var(--accent)',
  color: '#1a1a1a',
}

const ghostBtnStyle: React.CSSProperties = {
  ...btnBaseStyle,
  background: 'transparent',
  color: 'var(--secondary)',
  border: '1px solid var(--border)',
}
