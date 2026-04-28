'use client'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

type CheckoutAnalyticsPayload = {
  type: string
  invoiceId?: string
  amountRub?: number
  email?: string
  emailValid?: boolean
  reason?: string
  message?: string
}

export function trackClientEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
    return
  }

  window.gtag('event', name, params)
}

export async function logCheckoutEvent(payload: CheckoutAnalyticsPayload) {
  trackClientEvent(payload.type, {
    invoice_id: payload.invoiceId,
    amount_rub: payload.amountRub,
    email_valid: payload.emailValid,
    reason: payload.reason,
  })

  if (typeof window === 'undefined') {
    return
  }

  const body = JSON.stringify({
    ...payload,
    path: window.location.pathname,
  })

  try {
    await fetch('/api/payments/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      keepalive: true,
      cache: 'no-store',
    })
  } catch {
    // Intentionally ignore telemetry transport failures.
  }
}
