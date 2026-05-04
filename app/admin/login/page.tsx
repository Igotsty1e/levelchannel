'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

// Phase 7+ — separate operator login surface. Not linked from
// anywhere on the public site. After successful login, /admin's
// layout still gates by role: a non-admin who somehow lands here
// gets redirected to /cabinet. Same /api/auth/login endpoint as
// /login, just a stripped UI (no register link, no consent boxes,
// no "забыли пароль" — admin can recover via psql / CLI).

export default function AdminLoginPage() {
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
      router.push('/admin')
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 32,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            marginBottom: 8,
          }}
        >
          Админка
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
          Вход оператора
        </h1>

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

          {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary"
            style={{ width: '100%', marginTop: 8 }}
          >
            {submitting ? 'Входим…' : 'Войти'}
          </button>
        </form>
      </div>
    </main>
  )
}
