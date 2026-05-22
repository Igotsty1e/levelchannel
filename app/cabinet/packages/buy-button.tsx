'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { CloudPaymentsWidgetIntent } from '@/lib/payments/types'

// PKG-LEARNER-BUY LBL.1 — buy-button client island.
//
// POSTs /api/checkout/package/[slug] (server-authoritative; client only
// supplies the slug via URL — body is empty, the server reads accountId
// + email from the session). On 200:
// - mock provider → status='paid' (mock-auto-confirm fired inline) →
//   redirect to /thank-you?invoiceId=...&token=...
// - cloudpayments provider → status='pending' + checkoutIntent → launch
//   widget; on success, redirect with token.
//
// Idempotency-Key is generated fresh per click; double-click dedups
// via the server-side withIdempotency contract.

type Props = {
  slug: string
  titleRu: string
  amountRub: number
  // SAAS-PIVOT security-audit HIGH-1 (2026-05-23) — multi-tenant
  // disambiguation. The cabinet catalog still uses learner-wide
  // `listActivePackages()` (no teacher filter), so two teachers shipping
  // the same slug would otherwise both render with the same href and
  // the server could not tell them apart. Threading the row's UUID via
  // `?packageId=<uuid>` makes the buy POST deterministic — see
  // app/api/checkout/package/[slug]/route.ts.
  packageId: string
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function BuyButton({ slug, titleRu, amountRub, packageId }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onClick() {
    setErr(null)
    if (!confirm(`Купить пакет «${titleRu}» за ${amountRub} ₽?`)) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/checkout/package/${encodeURIComponent(slug)}?packageId=${encodeURIComponent(packageId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({}),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(
          data?.message
            ?? (data?.error === 'already_owns_active_package'
              ? 'У вас уже есть активный пакет такой же длительности.'
              : data?.error === 'pending_package_in_flight'
                ? 'У вас уже есть незавершённый платёж. Подождите и попробуйте снова.'
                : data?.error ?? `HTTP ${res.status}`),
        )
        setBusy(false)
        return
      }
      const invoiceId = data.invoiceId as string | undefined
      const receiptToken = data.receiptToken as string | undefined
      const provider = data.provider as string | undefined
      const status = data.status as string | undefined
      const checkoutIntent = data.checkoutIntent as
        | CloudPaymentsWidgetIntent
        | null
        | undefined

      if (!invoiceId || !receiptToken) {
        setErr('Не удалось получить номер платежа. Обновите страницу.')
        setBusy(false)
        return
      }

      // Mock provider: order already paid + grant fired inline.
      if (provider === 'mock' || status === 'paid' || !checkoutIntent) {
        router.push(
          `/thank-you?invoiceId=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(receiptToken)}`,
        )
        return
      }

      // Cloudpayments provider: launch widget.
      const cp = (window as Window & { cp?: { CloudPayments: new () => unknown } }).cp
      if (!cp?.CloudPayments) {
        setErr('Не удалось запустить виджет оплаты. Обновите страницу.')
        setBusy(false)
        return
      }
      type Widget = {
        oncomplete?: (result: { status?: string; type?: string }) => void
        start: (i: CloudPaymentsWidgetIntent) => Promise<{ status?: string }>
      }
      const widget = new cp.CloudPayments() as unknown as Widget
      const result = await new Promise<{ status?: string }>((resolve) => {
        widget.oncomplete = (r) =>
          resolve({ status: r?.status || r?.type || 'cancel' })
        widget
          .start(checkoutIntent)
          .then((r) => {
            if (r?.status === 'success') resolve(r)
          })
          .catch(() => resolve({ status: 'cancel' }))
      })
      if (result.status === 'success') {
        router.push(
          `/thank-you?invoiceId=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(receiptToken)}`,
        )
      } else {
        setErr('Оплата не завершена. Попробуйте ещё раз.')
        setBusy(false)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сети.')
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          background: 'var(--accent, #5b8ef7)',
          color: 'var(--accent-contrast, #fff)',
          border: 'none',
          borderRadius: 6,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Открываю оплату…' : 'Купить'}
      </button>
      {err ? (
        <div style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</div>
      ) : null}
    </div>
  )
}
