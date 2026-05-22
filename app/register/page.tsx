'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // SAAS-4 (2026-05-18) — capture the invite token from the URL. The
  // server-side preflight (validity + inviting teacher's email) is
  // intentionally out of scope for this slice: the client passes the
  // token to /api/auth/register, which verifies HMAC + redeems
  // atomically. A future polish PR can add a /api/teacher/invites/
  // preview endpoint to render «Вас пригласил <email>» before submit.
  const inviteToken = searchParams.get('invite') ?? null
  // SAAS-PIVOT Epic 1 Day 2 (2026-05-22) — `/register?role=teacher`
  // pre-selects the teacher branch so the teacher-acquisition landing
  // can deep-link learners → registration with the right role already
  // chosen (plan §5 Day 2 "/register?role=teacher route activation").
  // An invite token still forces role=student (anti-spoof on the
  // server) regardless of this query param.
  const roleFromQuery = searchParams.get('role')
  const initialRole: 'student' | 'teacher' =
    roleFromQuery === 'teacher' ? 'teacher' : 'student'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // An invited learner has role pre-locked to student.
  const [role, setRole] = useState<'student' | 'teacher'>(initialRole)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!consent) {
      setError('Подтвердите согласие на обработку персональных данных.')
      return
    }
    setSubmitting(true)
    const result = await postAuthJson('/api/auth/register', {
      email: email.trim(),
      password,
      personalDataConsentAccepted: true,
      role: inviteToken ? 'student' : role,
      ...(inviteToken ? { inviteToken } : {}),
    })
    if (result.ok) {
      router.push(`/verify-pending?email=${encodeURIComponent(email.trim())}`)
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Регистрация</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 32 }}>
        Уже есть аккаунт?{' '}
        <Link href="/login" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
          Войти
        </Link>
      </p>

      <form onSubmit={onSubmit}>
        <AuthField label="E-mail">
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        <AuthField label="Пароль" hint="Минимум 10 символов">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        {inviteToken ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.35)',
              color: '#bbf7d0',
              fontSize: 14,
              lineHeight: 1.4,
              marginBottom: 16,
            }}
          >
            Вы регистрируетесь по приглашению учителя. После регистрации вы будете автоматически привязаны к этому учителю.
          </div>
        ) : (
          <fieldset
            style={{
              border: 'none',
              margin: '0 0 16px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <legend
              style={{
                color: 'var(--secondary)',
                fontSize: 13,
                marginBottom: 6,
                padding: 0,
              }}
            >
              Кто вы?
            </legend>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="role"
                value="student"
                checked={role === 'student'}
                onChange={() => setRole('student')}
                disabled={submitting}
                style={{ accentColor: '#C87878' }}
              />
              <span>Я ученик — буду заниматься с учителем</span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="role"
                value="teacher"
                checked={role === 'teacher'}
                onChange={() => setRole('teacher')}
                disabled={submitting}
                style={{ accentColor: '#C87878' }}
              />
              <span>Я учитель — буду проводить занятия</span>
            </label>
          </fieldset>
        )}

        <label
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.5,
            marginTop: 16,
            marginBottom: 24,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={submitting}
            style={{ marginTop: 3, width: 18, height: 18, accentColor: '#C87878' }}
          />
          <span>
            Я согласен(на) с{' '}
            <Link href="/offer" style={{ color: 'var(--text)' }} target="_blank">
              офертой
            </Link>
            ,{' '}
            <Link href="/privacy" style={{ color: 'var(--text)' }} target="_blank">
              политикой обработки персональных данных
            </Link>{' '}
            и даю{' '}
            <Link href="/consent/personal-data" style={{ color: 'var(--text)' }} target="_blank">
              согласие на их обработку
            </Link>
            .
          </span>
        </label>

        {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Отправляем…' : 'Создать аккаунт'}
        </button>
      </form>
    </AuthShell>
  )
}
