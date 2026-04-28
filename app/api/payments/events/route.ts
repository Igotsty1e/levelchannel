import { NextResponse } from 'next/server'

import { appendCheckoutTelemetryEvent } from '@/lib/telemetry/store'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
  isValidInvoiceId,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EVENT_TYPE_PATTERN = /^checkout_[a-z0-9_]{2,64}$/i

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, 'payments:events', 120, 60_000)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  try {
    const body = (await request.json()) as {
      type?: string
      invoiceId?: string
      amountRub?: number
      email?: string
      emailValid?: boolean
      reason?: string
      message?: string
      path?: string
    }

    const type = String(body.type || '')
    if (!EVENT_TYPE_PATTERN.test(type)) {
      return NextResponse.json({ error: 'Invalid event type.' }, { status: 400 })
    }

    const invoiceId = body.invoiceId ? String(body.invoiceId) : undefined
    if (invoiceId && !isValidInvoiceId(invoiceId)) {
      return NextResponse.json({ error: 'Invalid payment id.' }, { status: 400 })
    }

    await appendCheckoutTelemetryEvent({
      type,
      invoiceId,
      amountRub:
        typeof body.amountRub === 'number' && Number.isFinite(body.amountRub)
          ? body.amountRub
          : undefined,
      email: typeof body.email === 'string' ? body.email : undefined,
      emailValid: typeof body.emailValid === 'boolean' ? body.emailValid : undefined,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 80) : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 200) : undefined,
      path: typeof body.path === 'string' ? body.path.slice(0, 120) : undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      ip: getClientIp(request),
    })

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    )
  } catch {
    return NextResponse.json({ error: 'Unable to store telemetry event.' }, { status: 500 })
  }
}
