import Link from 'next/link'

import { AuthShell } from '@/components/auth-shell'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ссылка недействительна — LevelChannel',
}

export default function VerifyFailedPage() {
  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Ссылка недействительна</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
        Эта ссылка истекла, уже использована или повреждена. Попробуйте перезапросить подтверждение или войти, если e-mail уже подтверждён.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/login" className="btn-primary">
          Войти
        </Link>
        <Link href="/register" className="btn-secondary">
          Зарегистрироваться заново
        </Link>
      </div>
    </AuthShell>
  )
}
