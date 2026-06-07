'use client'

import { useState } from 'react'

import { Banner } from '@/components/ui/primitives/banner'
import { Button } from '@/components/ui/primitives/button'

// Deep UX redesign of /teacher/profile danger zone (2026-06-07).
//
// Why a separate teacher-scoped component:
//   - Cabinet learner's <DangerZone> stays as-is (no need to break a
//     stable surface). This one uses primitives + tokens + collapse
//     pattern that the teacher cabinet has standardised on.
//
// Visual contract (per task):
//   - Closed by default. Header row is a tap target with a chevron.
//     Title in danger tone, but body is hidden so the page doesn't
//     scream «delete» as the teacher just lands.
//   - Once expanded, a single <Banner tone="danger"> explains both
//     consequences in one short sentence per option, then the action
//     row uses <Button variant="danger" /> + <Button variant="secondary" />.
//   - Each action confirms via window.confirm() (same posture as
//     /cabinet/danger-zone — backend already accepts a single POST and
//     issues the 30-day grace).
//
// Backend contract is unchanged:
//   - POST /api/account/consents/withdraw  (152-ФЗ ст.9 §5)
//   - POST /api/account/delete             (30-day soft-delete grace)
// Both clear the session cookie and we hard-redirect to /login on 2xx.

export function TeacherDangerCard() {
  const [open, setOpen] = useState(false)

  return (
    <section
      aria-labelledby="teacher-profile-danger-title"
      style={cardStyle}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="teacher-profile-danger-body"
        style={triggerStyle}
      >
        <span style={triggerLabelStyle}>
          <span aria-hidden="true" style={dangerDotStyle} />
          <span
            id="teacher-profile-danger-title"
            style={triggerTitleStyle}
          >
            Удалить аккаунт или отозвать согласие
          </span>
        </span>
        <span aria-hidden="true" style={chevronStyle(open)}>
          ›
        </span>
      </button>

      {open ? (
        <div id="teacher-profile-danger-body" style={bodyStyle}>
          <Banner tone="danger" icon="⚠">
            <strong>Это разлогинит и заблокирует доступ.</strong> Учеников,
            расписание и оплаты ты увидишь только если оператор восстановит
            аккаунт.
          </Banner>

          <ul style={listStyle}>
            <li style={listItemStyle}>
              <strong style={listStrongStyle}>Отзыв согласия</strong> —
              152-ФЗ ст.9 §5: оператор перестаёт обрабатывать персональные
              данные, аккаунт блокируется, данные сохраняются. Снять блок —
              написать на{' '}
              <a href="mailto:support@levelchannel.ru" style={linkStyle}>
                support@levelchannel.ru
              </a>
              .
            </li>
            <li style={listItemStyle}>
              <strong style={listStrongStyle}>Удаление аккаунта</strong> —
              30 дней окно отмены, восстановить можно через оператора. После
              этого данные обезличиваются (имя, e-mail, телефон стираются) —
              необратимо.
            </li>
          </ul>

          <div style={actionsRowStyle}>
            <DangerAction
              endpoint="/api/account/consents/withdraw"
              body={{ documentKind: 'personal_data' }}
              confirmText="Отозвать согласие на обработку персональных данных? Аккаунт будет заблокирован."
              label="Отозвать согласие"
              variant="secondary"
            />
            <DangerAction
              endpoint="/api/account/delete"
              body={{ confirm: true }}
              confirmText="Удалить аккаунт? Окно отмены — 30 дней, после этого данные обезличиваются."
              label="Удалить аккаунт"
              variant="danger"
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DangerAction({
  endpoint,
  body,
  confirmText,
  label,
  variant,
}: {
  endpoint: string
  body: Record<string, unknown>
  confirmText: string
  label: string
  variant: 'danger' | 'secondary'
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onClick() {
    if (typeof window === 'undefined') return
    if (!window.confirm(confirmText)) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErr((data && (data.message || data.error)) || `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      window.location.href = '/login'
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={onClick}
        disabled={busy}
        loading={busy}
      >
        {label}
      </Button>
      {err ? <span style={errInlineStyle}>{err}</span> : null}
    </span>
  )
}

// — styles —

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--danger-bg, var(--border))',
  borderRadius: 12,
  marginBottom: 16,
  overflow: 'hidden',
}

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  padding: '16px 20px',
  background: 'transparent',
  border: 0,
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}

const triggerLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
}

const dangerDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: 999,
  background: 'var(--danger)',
}

const triggerTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.3,
  color: 'var(--text)',
}

const chevronStyle = (open: boolean): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: 20,
  lineHeight: 1,
  color: 'var(--secondary)',
  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
  transition: 'transform 120ms ease',
})

const bodyStyle: React.CSSProperties = {
  padding: '0 20px 20px',
  borderTop: '1px solid var(--border)',
  paddingTop: 16,
}

const listStyle: React.CSSProperties = {
  margin: '0 0 16px',
  paddingLeft: 20,
  color: 'var(--secondary)',
  fontSize: 13,
  lineHeight: 1.6,
}

const listItemStyle: React.CSSProperties = {
  marginBottom: 8,
}

const listStrongStyle: React.CSSProperties = {
  color: 'var(--text)',
}

const linkStyle: React.CSSProperties = {
  color: 'var(--text)',
  textDecoration: 'underline',
}

const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 4,
}

const errInlineStyle: React.CSSProperties = {
  color: 'var(--danger)',
  fontSize: 12,
}
