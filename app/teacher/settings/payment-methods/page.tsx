// teacher-payments-sbp-self-service Sub-PR A1 (2026-06-07).
//
// Учительская страница настроек СБП-реквизитов.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.1.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listActivePaymentMethods } from '@/lib/payments/sbp-methods'

import { PaymentMethodsEditor } from './editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Учёт оплат через СБП — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherPaymentMethodsPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const methods = await listActivePaymentMethods(session.account.id)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Link
        href="/teacher/settings"
        style={{
          color: 'var(--secondary)',
          textDecoration: 'none',
          fontSize: 14,
          display: 'inline-block',
          marginBottom: 16,
        }}
      >
        ← Назад в настройки
      </Link>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          margin: 0,
          marginBottom: 8,
          letterSpacing: '-0.01em',
        }}
      >
        Учёт оплат через СБП
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.6,
          margin: 0,
          marginBottom: 24,
        }}
      >
        Укажите номер телефона и банк для учёта платежей через СБП.
        После сохранения ученики увидят эти реквизиты на кнопке «Оплатить»
        в своём кабинете. Можно добавить несколько методов и закрепить
        разные за разными учениками.
      </p>

      <PaymentMethodsEditor initialMethods={methods} />
    </div>
  )
}
