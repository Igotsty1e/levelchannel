'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import {
  AuthErrorBox,
  AuthField,
  AuthInfoBox,
  authInputStyle,
} from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const result = await postAuthJson('/api/auth/reset-request', {
      email: email.trim(),
    })
    // Anti-enumeration: server returns 200 for both known and unknown
    // emails. UI shows the same neutral message regardless of outcome.
    if (result.ok || result.status === 200) {
      setDone(true)
      setSubmitting(false)
      return
    }
    if (result.status === 0 || result.status === 429) {
      setError(result.error)
    } else {
      // For any other server-side rejection (validation), still show the
      // neutral confirmation — never confirm or deny that the email exists.
      setDone(true)
    }
    setSubmitting(false)
  }

  if (done) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Проверьте почту</h1>
        <AuthInfoBox>
          Если такой e-mail зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля. Если письмо не пришло за 5 минут — проверьте спам.
        </AuthInfoBox>
        <Link href="/login" className="btn-secondary">
          Вернуться ко входу
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Восстановление пароля</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 32 }}>
        Введите e-mail аккаунта — пришлём письмо со ссылкой для сброса пароля.
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

        {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Отправляем…' : 'Отправить письмо'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link
            href="/login"
            style={{ color: 'var(--secondary)', fontSize: 14, textDecoration: 'underline' }}
          >
            Назад ко входу
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
