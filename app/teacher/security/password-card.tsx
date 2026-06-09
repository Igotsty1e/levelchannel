'use client'

import { CSSProperties, FormEvent, useEffect, useState } from 'react'

import { track } from '@/lib/analytics/track'

const ERROR_COPY: Record<string, string> = {
  'password/current/invalid': 'Текущий пароль не совпадает.',
  'password/new/too_short':
    'Новый пароль должен быть не короче 8 символов.',
  'password/new/too_long': 'Новый пароль слишком длинный.',
  'password/new/all_digits': 'Пароль не должен состоять только из цифр.',
  'password/new/too_common':
    'Этот пароль слишком распространён — выберите другой.',
  'password/new/same_as_current': 'Новый пароль совпадает со старым.',
  rate_limited: 'Слишком много попыток. Подождите минуту.',
}

export function PasswordChangeCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    track('password_change_form_opened', {})
  }, [])

  const mismatch = next !== '' && confirm !== '' && next !== confirm
  const canSubmit =
    current.length > 0 &&
    next.length >= 8 &&
    confirm.length > 0 &&
    !mismatch &&
    !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    setOk(false)
    track('password_change_submitted', {})
    try {
      const res = await fetch('/api/account/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        message?: string
      } | null
      if (res.status === 429) {
        setErr(ERROR_COPY.rate_limited)
        track('password_change_failed', { reason: 'rate_limited' })
        return
      }
      if (res.ok && body?.ok) {
        setOk(true)
        setCurrent('')
        setNext('')
        setConfirm('')
        track('password_change_succeeded', {})
        return
      }
      const reason = body?.error ?? 'unknown'
      setErr(
        ERROR_COPY[reason] ??
          body?.message ??
          'Не получилось обновить. Попробуйте ещё раз.',
      )
      track('password_change_failed', {
        reason: reason.startsWith('password/current')
          ? 'current_invalid'
          : reason.startsWith('password/new/too_')
            ? 'new_weak'
            : reason === 'password/new/same_as_current'
              ? 'same_as_current'
              : 'unknown',
      })
    } catch {
      setErr('Сетевая ошибка. Проверьте подключение.')
      track('password_change_failed', { reason: 'unknown' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={cardStyle} aria-labelledby="pw-change-title">
      <header style={{ marginBottom: 16 }}>
        <h2 id="pw-change-title" style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
          Изменить пароль
        </h2>
        <p style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          Минимум 8 символов. Не используйте популярный пароль или только цифры.
        </p>
      </header>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
        <PasswordField
          id="pw-current"
          label="Текущий пароль"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          show={showCurrent}
          onToggle={() => setShowCurrent(!showCurrent)}
          disabled={busy}
        />
        <PasswordField
          id="pw-new"
          label="Новый пароль"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          show={showNext}
          onToggle={() => setShowNext(!showNext)}
          disabled={busy}
        />
        <PasswordField
          id="pw-confirm"
          label="Подтвердите новый пароль"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          show={showConfirm}
          onToggle={() => setShowConfirm(!showConfirm)}
          error={mismatch ? 'Не совпадает с новым паролем.' : null}
          disabled={busy}
        />

        {err ? (
          <div role="alert" style={errorStyle}>
            {err}
          </div>
        ) : null}
        {ok ? (
          <div role="status" style={okStyle}>
            Пароль обновлён. На других устройствах вы разлогинены.
          </div>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              ...buttonStyle,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  show,
  onToggle,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  autoComplete: string
  show: boolean
  onToggle: () => void
  error?: string | null
  disabled?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} style={fieldLabelStyle}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={1}
          required
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          style={{ ...inputStyle, paddingRight: 44 }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
          style={eyeBtnStyle}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-err`} style={fieldErrorStyle}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function EyeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l16 16" />
      <path d="M9.5 5.5c.8-.15 1.65-.25 2.5-.25 6 0 9.5 6.5 9.5 6.5a13.8 13.8 0 0 1-3.2 3.85" />
      <path d="M6.4 7.05A14 14 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.55 0 2.95-.45 4.2-1.15" />
      <path d="M9.8 9.8a3 3 0 0 0 4.4 4.4" />
    </svg>
  )
}

const cardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
}

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--secondary)',
  marginBottom: 6,
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 15,
  boxSizing: 'border-box',
}

const eyeBtnStyle: CSSProperties = {
  position: 'absolute',
  right: 4,
  top: '50%',
  transform: 'translateY(-50%)',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 8,
  color: 'var(--secondary)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const fieldErrorStyle: CSSProperties = {
  color: 'var(--danger, #f87171)',
  fontSize: 12,
  margin: '6px 0 0',
}

const errorStyle: CSSProperties = {
  padding: 10,
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.4)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
}

const okStyle: CSSProperties = {
  padding: 10,
  background: 'rgba(74,222,128,0.08)',
  border: '1px solid rgba(74,222,128,0.4)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
}

const buttonStyle: CSSProperties = {
  padding: '10px 18px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
}
