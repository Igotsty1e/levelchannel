'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import {
  AuthErrorBox,
  AuthField,
  AuthInfoBox,
  authInputStyle,
} from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export const dynamic = 'force-dynamic'

function ResetContent() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!token) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Ссылка повреждена</h1>
        <p style={{ color: 'var(--secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
          Сcылка для сброса пароля отсутствует или повреждена. Запросите письмо повторно.
        </p>
        <Link href="/forgot" className="btn-primary">
          Запросить новое письмо
        </Link>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Пароль обновлён</h1>
        <AuthInfoBox>
          Пароль обновлён, и вы автоматически вошли в кабинет. Все остальные сессии этого аккаунта завершены.
        </AuthInfoBox>
        <Link href="/cabinet" className="btn-primary">
          Перейти в кабинет
        </Link>
      </AuthShell>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    if (password !== confirm) {
      setError('Пароли не совпадают.')
      return
    }

    setSubmitting(true)
    const result = await postAuthJson('/api/auth/reset-confirm', {
      token,
      password,
    })
    if (result.ok) {
      setDone(true)
      setSubmitting(false)
      // Stay on the page to show the success state. /cabinet button is
      // visible there. Auto-redirect would surprise the user.
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Новый пароль</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 32 }}>
        Придумайте новый пароль для вашего аккаунта.
      </p>

      <form onSubmit={onSubmit}>
        <AuthField label="Новый пароль" hint="Минимум 10 символов">
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

        <AuthField label="Повторите пароль">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Сохраняем…' : 'Сохранить новый пароль'}
        </button>
      </form>
    </AuthShell>
  )
}

export default function ResetPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Новый пароль</h1>
        </AuthShell>
      }
    >
      <ResetContent />
    </Suspense>
  )
}
