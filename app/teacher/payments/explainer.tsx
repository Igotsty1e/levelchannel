'use client'

// teacher-payments-sbp-self-service Sub-PR F: explainer banner.
// Dismissible через existing onboarding_state.

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Banner, Button } from '@/components/ui/primitives'

export function PaymentsExplainer() {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)

  async function dismiss() {
    setDismissed(true)
    try {
      await fetch('/api/onboarding/dismiss-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hintKey: 'teacher_payments_explainer' }),
      })
    } catch {
      // best-effort
    }
    router.refresh()
  }

  if (dismissed) return null

  return (
    <Banner
      tone="info"
      action={
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Понятно
        </Button>
      }
    >
      <strong>Как устроен учёт оплат.</strong> Платформа не держит ваши
      деньги — ученики платят вам напрямую через СБП. Этот раздел — ваш
      журнал: кто заплатил, кто должен, у кого заканчивается абонемент.
      В «Ждут подтверждения» — заявки, которые отметили сами ученики
      («Я оплатил»). В «Должны оплатить» можно отметить оплату самому,
      если ученик заплатил наличными или забыл нажать кнопку.
    </Banner>
  )
}
