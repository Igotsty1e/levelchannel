'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

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
// CloudPayments script is loaded globally by app/layout.tsx, so
// `window.cp` is available without a per-page <Script />.

type Props = {
  tariffTitle: string
  tariffSlug: string
  amountKopecks: number
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
  tariffSlug,
  amountKopecks,
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
            ? `Слот ${slotId.slice(0, 8)} — тариф ${tariffSlug}`
            : `Тариф ${tariffSlug}`,
          ...(slotId ? { slotId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        setBusy(false)
        return
      }
      const intent = data.checkoutIntent as CloudPaymentsWidgetIntent | null
      const invoiceId = data.order?.invoiceId as string | undefined
      const cp = (window as Window & { cp?: { CloudPayments: new () => unknown } }).cp
      if (!intent || !cp?.CloudPayments) {
        // No widget intent — provider is mock or script not loaded.
        // In mock mode the order still lands; redirect to /thank-you
        // so the existing page polls the order to terminal status.
        if (invoiceId) {
          router.push(`/thank-you?invoiceId=${encodeURIComponent(invoiceId)}`)
        } else {
          setErr(
            'Не удалось запустить оплату. Обновите страницу и попробуйте снова.',
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
        router.push(`/thank-you?invoiceId=${encodeURIComponent(invoiceId!)}`)
      } else {
        setErr(
          'Оплата не завершена. Можно попробовать ещё раз — этот же тариф откроется заново.',
        )
        setBusy(false)
      }
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'unknown')
      setBusy(false)
    }
  }

  return (
    <section
      className="container"
      style={{ padding: '64px 16px 96px', maxWidth: 540 }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Оплата: {tariffTitle}
      </h1>
      {descriptionRu ? (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
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
            background: 'rgba(255,255,255,0.02)',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: 'var(--secondary)', marginBottom: 4 }}>
            Оплата за бронь:
          </div>
          <div>
            {new Date(slotStartAt).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            · {slotDurationMinutes} мин
          </div>
        </div>
      ) : null}

      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        {new Intl.NumberFormat('ru-RU').format(amountRub)} ₽
      </div>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          marginBottom: 24,
        }}
      >
        Сумма зафиксирована тарифом «{tariffSlug}». Оплата проходит через
        CloudPayments — форма откроется поверх сайта.
      </p>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span
            style={{
              display: 'block',
              color: 'var(--secondary)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
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
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: 15,
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            gap: 8,
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--secondary)',
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

        <button
          type="submit"
          disabled={!submittable}
          style={{
            marginTop: 8,
            padding: '14px 18px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: submittable ? 'pointer' : 'not-allowed',
            opacity: submittable ? 1 : 0.6,
          }}
        >
          {busy ? 'Открываем форму…' : 'Перейти к оплате'}
        </button>

        {err ? (
          <p style={{ color: '#FCA5A5', fontSize: 13, marginTop: 4 }}>{err}</p>
        ) : null}

        {/* slotId hidden field is informational only — ?slot is in the URL */}
        {process.env.NODE_ENV !== 'production' && slotId ? (
          <p style={{ color: 'var(--secondary)', fontSize: 11 }}>
            slotId={slotId}, amountKopecks={amountKopecks}
          </p>
        ) : null}
      </form>
    </section>
  )
}
