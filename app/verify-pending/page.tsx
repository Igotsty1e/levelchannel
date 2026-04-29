'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

import { AuthShell } from '@/components/auth-shell'

export const dynamic = 'force-dynamic'

function VerifyPendingContent() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Письмо отправлено</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 16 }}>
        {email ? (
          <>
            На адрес <span style={{ color: 'var(--text)' }}>{email}</span> отправлено письмо.
          </>
        ) : (
          <>На указанный e-mail отправлено письмо.</>
        )}{' '}
        Нажмите ссылку в нём, чтобы подтвердить адрес и войти в кабинет.
      </p>
      <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
        Если письмо не пришло за 5 минут — проверьте папку «Спам» или попробуйте зарегистрироваться ещё раз.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/login" className="btn-secondary">
          Войти
        </Link>
        <Link href="/register" className="btn-secondary">
          Зарегистрироваться заново
        </Link>
      </div>
    </AuthShell>
  )
}

export default function VerifyPendingPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Письмо отправлено</h1>
        </AuthShell>
      }
    >
      <VerifyPendingContent />
    </Suspense>
  )
}
