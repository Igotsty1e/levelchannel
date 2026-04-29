'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
