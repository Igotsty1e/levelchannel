import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PAY-SBP-REMOVAL (2026-05-20) — verifies the operator-disabled gate
// on POST /api/payments/sbp/create-qr. The gate sits between
// rate-limit and origin-check; when SBP_ENABLED !== 'true' the route
// responds 503 sbp_disabled WITHOUT invoking createSbpQr / createOrder
// / audit-events. This is the only path tested here — the happy-path
// (SBP_ENABLED='true') requires a much heavier mock surface and is
// covered by manual smoke until the SBP UI is revived.

const createSbpQrMock = vi.fn()
vi.mock('@/lib/payments/cloudpayments-api', () => ({
  createSbpQr: (args: unknown) => createSbpQrMock(args),
}))

const createOrderMock = vi.fn()
const updateOrderMock = vi.fn()
vi.mock('@/lib/payments/store', () => ({
  createOrder: (...a: unknown[]) => createOrderMock(...a),
  updateOrder: (...a: unknown[]) => updateOrderMock(...a),
}))

const markOrderFailedMock = vi.fn()
vi.mock('@/lib/payments/provider', () => ({
  markOrderFailed: (...a: unknown[]) => markOrderFailedMock(...a),
}))

const recordPaymentAuditEventMock = vi.fn()
vi.mock('@/lib/audit/payment-events', async () => {
  const real = await vi.importActual<
    typeof import('@/lib/audit/payment-events')
  >('@/lib/audit/payment-events')
  return {
    ...real,
    recordPaymentAuditEvent: (...a: unknown[]) =>
      recordPaymentAuditEventMock(...a),
  }
})

const appendCheckoutTelemetryEventMock = vi.fn()
vi.mock('@/lib/telemetry/store', () => ({
  appendCheckoutTelemetryEvent: (...a: unknown[]) =>
    appendCheckoutTelemetryEventMock(...a),
}))

const enforceRateLimitMock = vi.fn().mockResolvedValue(null)
const enforceTrustedBrowserOriginMock = vi.fn().mockReturnValue(null)
vi.mock('@/lib/security/request', () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimitMock(...a),
  enforceTrustedBrowserOrigin: () => enforceTrustedBrowserOriginMock(),
  getClientIp: () => '203.0.113.1',
}))

vi.mock('@/lib/security/idempotency', () => ({
  withIdempotency: async (
    _r: Request,
    _scope: string,
    _body: string,
    work: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const out = await work()
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { 'content-type': 'application/json' },
    })
  },
}))

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/payments/sbp/create-qr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'lc-sbp-test-key',
      ...headers,
    },
    body: JSON.stringify({
      amountRub: 1000,
      customerEmail: 'test@example.com',
      personalDataConsentAccepted: true,
    }),
  })
}

describe('POST /api/payments/sbp/create-qr — SBP_ENABLED gate', () => {
  const HAD_ORIGINAL_ENV = Object.prototype.hasOwnProperty.call(
    process.env,
    'SBP_ENABLED',
  )
  const originalEnv = process.env.SBP_ENABLED

  beforeEach(() => {
    vi.clearAllMocks()
    enforceRateLimitMock.mockResolvedValue(null)
    enforceTrustedBrowserOriginMock.mockReturnValue(null)
  })

  afterEach(() => {
    // Wave-paranoia round-1 WARN #3 closure — `process.env.X = undefined`
    // coerces to the literal string "undefined" instead of removing
    // the key. Restore the original ABSENCE of the var when it wasn't
    // set going in, so the suite is not order-dependent for other
    // tests in the same Vitest worker.
    if (HAD_ORIGINAL_ENV && originalEnv !== undefined) {
      process.env.SBP_ENABLED = originalEnv
    } else {
      delete process.env.SBP_ENABLED
    }
    vi.resetModules()
  })

  it('returns 503 sbp_disabled when SBP_ENABLED is absent', async () => {
    delete process.env.SBP_ENABLED

    const { POST } = await import(
      '@/app/api/payments/sbp/create-qr/route'
    )
    const response = await POST(buildRequest())

    expect(response.status).toBe(503)
    const json = (await response.json()) as {
      error?: string
      message?: string
    }
    expect(json.error).toBe('sbp_disabled')
    expect(response.headers.get('Retry-After')).toBe('3600')
    expect(response.headers.get('Cache-Control')).toContain('no-store')

    // The gate must short-circuit before any downstream side-effect.
    expect(createSbpQrMock).not.toHaveBeenCalled()
    expect(createOrderMock).not.toHaveBeenCalled()
    expect(recordPaymentAuditEventMock).not.toHaveBeenCalled()
    expect(appendCheckoutTelemetryEventMock).not.toHaveBeenCalled()
  })

  it('returns 503 sbp_disabled when SBP_ENABLED is "false"', async () => {
    process.env.SBP_ENABLED = 'false'

    const { POST } = await import(
      '@/app/api/payments/sbp/create-qr/route'
    )
    const response = await POST(buildRequest())

    expect(response.status).toBe(503)
    expect(createSbpQrMock).not.toHaveBeenCalled()
    expect(createOrderMock).not.toHaveBeenCalled()
  })

  it('returns 503 sbp_disabled when SBP_ENABLED is a truthy-but-not-"true" string', async () => {
    process.env.SBP_ENABLED = '1'

    const { POST } = await import(
      '@/app/api/payments/sbp/create-qr/route'
    )
    const response = await POST(buildRequest())

    // Exact-match guard: '1' is truthy but not literal 'true' → still
    // 503. This locks down the env-exact-match convention.
    expect(response.status).toBe(503)
    expect(createSbpQrMock).not.toHaveBeenCalled()
  })

  it('runs the gate after rate-limit (rate-limit response wins)', async () => {
    delete process.env.SBP_ENABLED
    // Simulate a rate-limit hit — must respond from rate-limit, not the
    // SBP gate (we don't want operators to confuse the two states).
    const rateLimitResponse = new Response(
      JSON.stringify({ error: 'rate_limited' }),
      { status: 429 },
    )
    enforceRateLimitMock.mockResolvedValueOnce(rateLimitResponse)

    const { POST } = await import(
      '@/app/api/payments/sbp/create-qr/route'
    )
    const response = await POST(buildRequest())

    expect(response.status).toBe(429)
    expect(createSbpQrMock).not.toHaveBeenCalled()
  })

  it('runs the gate before origin-check (no-Origin curl still sees 503)', async () => {
    delete process.env.SBP_ENABLED
    // origin-check would return 403 for missing/bad Origin. The gate
    // must short-circuit BEFORE origin-check so the operator-disabled
    // state is consistent regardless of caller class.
    enforceTrustedBrowserOriginMock.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'forbidden_origin' }), {
        status: 403,
      }),
    )

    const { POST } = await import(
      '@/app/api/payments/sbp/create-qr/route'
    )
    const response = await POST(buildRequest())

    expect(response.status).toBe(503)
    expect(enforceTrustedBrowserOriginMock).not.toHaveBeenCalled()
  })
})
