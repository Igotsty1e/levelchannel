'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/primitives'

// Phase 6 tariff-bound checkout client island.
//
// Mirrors a tiny subset of components/payments/pricing-section.tsx —
// only what's needed to: collect e-mail + consent, POST /api/payments
// with a fixed amountRub + optional slotId, then launch the
// CloudPayments widget the API returned. On success we redirect to
// /thank-you?invoiceId=...; on cancel/failure we surface a message.
//
// Deliberate non-features in this wave:
//   - no remember-card (saved tokens stay scoped to /pay free-amount)
//   - no 1-click charge from saved card
//   - no SSE status push (the widget itself reports success and the
//     /thank-you page polls /api/payments/<id> for the rest)
//   - no comment field (operator workflow that needs comments still
//     uses /pay)
//
// CloudPayments script is loaded by app/checkout/[tariffSlug]/page.tsx
// at the page level (Codex 2026-05-08 Wave 10 #5 — layout-level load
// was removed). This client island assumes `window.cp` has been
// hydrated by the time `onSubmit` fires.

type Props = {
  tariffTitle: string
  // tariffSlug + amountKopecks are received but not currently rendered or
  // logged in UI (jargon-leak avoidance per docs/design-system.md §11).
  // We accept them as an optional pass-through so the parent contract is
  // stable; if you need them again, plumb them through explicitly.
  tariffSlug?: string
  amountKopecks?: number
  amountRub: number
  descriptionRu: string | null
  slotId: string | null
  slotStartAt: string | null
  slotDurationMinutes: number | null
}

// We do NOT re-declare `Window.cp` here — components/payments/pricing-section.tsx
// owns the global declaration. We just access window.cp through that
// existing typing.
import type { CloudPaymentsWidgetIntent } from '@/lib/payments/types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CheckoutForm({
  tariffTitle,
  amountRub,
  descriptionRu,
  slotId,
  slotStartAt,
  slotDurationMinutes,
}: Props) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const emailValid = EMAIL_PATTERN.test(email.trim())
  const submittable = emailValid && consent && !busy

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!submittable) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountRub,
          customerEmail: email.trim(),
          personalDataConsentAccepted: true,
          customerComment: slotId
            ? `Занятие — ${tariffTitle}`
            : tariffTitle,
          ...(slotId ? { slotId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(
          data?.message ||
            data?.error ||
            'Не получилось начать оплату. Попробуйте ещё раз.',
        )
        setBusy(false)
        return
      }
      const intent = data.checkoutIntent as CloudPaymentsWidgetIntent | null
      const invoiceId = data.order?.invoiceId as string | undefined
      // PKG-LEARNER-BUY LBL.2 — thread the plain receipt token into the
      // /thank-you redirect. Without `&token=`, the page hits the
      // receipt-token gate on /api/payments/[invoiceId] and 401s.
      // Affects BOTH the mock-no-widget path and the cloudpayments
      // success path below. 3DS-callback redirect is out of scope (the
      // plain token is only known at order-init).
      const receiptToken = data.receiptToken as string | undefined
      const thankYouHref = (id: string) =>
        receiptToken
          ? `/thank-you?invoiceId=${encodeURIComponent(id)}&token=${encodeURIComponent(receiptToken)}`
          : `/thank-you?invoiceId=${encodeURIComponent(id)}`
      const cp = (window as Window & { cp?: { CloudPayments: new () => unknown } }).cp
      if (!intent || !cp?.CloudPayments) {
        // No widget intent — provider is mock or script not loaded.
        // In mock mode the order still lands; redirect to /thank-you
        // so the existing page polls the order to terminal status.
        if (invoiceId) {
          router.push(thankYouHref(invoiceId))
        } else {
          setErr(
            'Не получилось открыть форму оплаты. Обновите страницу и попробуйте снова.',
          )
        }
        setBusy(false)
        return
      }

      // We type the widget surface narrowly here (status: string) to
      // avoid clobbering the strict union type the global declaration
      // in components/payments/pricing-section.tsx asserts.
      type Widget = {
        oncomplete?: (result: { status?: string; type?: string }) => void
        start: (i: CloudPaymentsWidgetIntent) => Promise<{ status?: string }>
      }
      const widget = new cp.CloudPayments() as unknown as Widget
      const result = await new Promise<{ status?: string }>((resolve) => {
        widget.oncomplete = (r) =>
          resolve({ status: r?.status || r?.type || 'cancel' })
        widget
          .start(intent)
          .then((r) => {
            if (r?.status === 'success') resolve(r)
          })
          .catch(() => resolve({ status: 'cancel' }))
      })

      if (result.status === 'success') {
        router.push(thankYouHref(invoiceId!))
      } else {
        setErr(
          'Оплата не прошла. Можно попробовать ещё раз — этот же тариф откроется заново.',
        )
        setBusy(false)
      }
    } catch (caught) {
      setErr(
        caught instanceof Error
          ? caught.message
          : 'Не получилось связаться с сервером оплаты. Попробуйте ещё раз.',
      )
      setBusy(false)
    }
  }

  const amountFormatted = new Intl.NumberFormat('ru-RU').format(amountRub)
  return (
    <section
      className="container"
      style={{ padding: '64px 16px 96px', maxWidth: 540 }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: 8,
          color: 'var(--text-primary)',
        }}
      >
        {tariffTitle}
      </h1>
      {descriptionRu ? (
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 15,
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          {descriptionRu}
        </p>
      ) : null}

      {slotId && slotStartAt ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 20,
            background: 'var(--surface-1)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
            Оплата за занятие:
          </div>
          <div style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {new Date(slotStartAt).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {slotDurationMinutes ? ` · ${slotDurationMinutes} мин` : ''}
          </div>
        </div>
      ) : null}

      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          marginBottom: 4,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {amountFormatted} ₽
      </div>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 24,
        }}
      >
        Сумма зафиксирована тарифом. Форма оплаты откроется поверх страницы.
      </p>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span
            style={{
              display: 'block',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            E-mail для чека
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 15,
              lineHeight: 1.5,
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            gap: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
            style={{ marginTop: 4 }}
          />
          <span>
            Я согласен(на) с{' '}
            <a href="/offer" style={{ color: 'var(--accent)' }}>
              офертой
            </a>
            ,{' '}
            <a href="/privacy" style={{ color: 'var(--accent)' }}>
              политикой обработки персональных данных
            </a>{' '}
            и даю{' '}
            <a
              href="/consent/personal-data"
              style={{ color: 'var(--accent)' }}
            >
              согласие на их обработку
            </a>
            .
          </span>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!submittable}
          loading={busy}
        >
          {busy ? 'Открываем форму' : 'Перейти к оплате'}
        </Button>

        {err ? (
          <p
            role="alert"
            style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}
          >
            {err}
          </p>
        ) : null}
      </form>
    </section>
  )
}
