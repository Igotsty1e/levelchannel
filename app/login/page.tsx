'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const result = await postAuthJson('/api/auth/login', {
      email: email.trim(),
      password,
    })
    if (result.ok) {
      router.push('/cabinet')
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Вход</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 32 }}>
        Нет аккаунта?{' '}
        <Link href="/register" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
          Зарегистрироваться
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

        <AuthField label="Пароль">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        <div style={{ marginBottom: 24, marginTop: -4 }}>
          <Link
            href="/forgot"
            style={{ color: 'var(--secondary)', fontSize: 14, textDecoration: 'underline' }}
          >
            Забыли пароль?
          </Link>
        </div>

        {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </AuthShell>
  )
}
