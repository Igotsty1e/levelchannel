'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Plan G — `/login?invite=<token>`. When present, the login POST
  // forwards the token to the server which redeems it as part of the
  // authenticated session creation (atomic CTE in
  // `redeemInviteAndBindLearnerAtomic`). This lets an EXISTING learner
  // bind to a NEW teacher without re-registering — the symmetric
  // counterpart of /register?invite= for fresh accounts.
  const inviteToken = searchParams.get('invite') ?? null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setInviteNotice(null)
    setSubmitting(true)
    const result = await postAuthJson('/api/auth/login', {
      email: email.trim(),
      password,
      ...(inviteToken ? { inviteToken } : {}),
    })
    if (result.ok) {
      // Surface invite-redeem outcome (best-effort — login succeeded
      // regardless). The cabinet shows the learner the teacher block
      // on the next page render, so an `ok` redeem is self-evident.
      const data = (result as { data?: { inviteRedeem?: string } }).data ?? null
      if (data?.inviteRedeem && data.inviteRedeem !== 'ok') {
        setInviteNotice(
          data.inviteRedeem === 'invalid'
            ? 'Ссылка-приглашение испорчена. Войти удалось — но привязка к учителю не сделана.'
            : 'Ссылка-приглашение уже использована или истёк срок. Войти удалось — но привязка к учителю не сделана.',
        )
        // Don't redirect — let user read the notice; they can navigate
        // to /cabinet manually via the link below or the next CTA.
        setSubmitting(false)
        return
      }
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
        {inviteNotice ? (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(224, 168, 80, 0.10)',
              border: '1px solid rgba(224, 168, 80, 0.45)',
              color: 'var(--text)',
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {inviteNotice}{' '}
            <Link
              href="/cabinet"
              style={{ color: 'var(--accent, #6ea8fe)', textDecoration: 'underline' }}
            >
              Перейти в кабинет
            </Link>
          </div>
        ) : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </AuthShell>
  )
}
