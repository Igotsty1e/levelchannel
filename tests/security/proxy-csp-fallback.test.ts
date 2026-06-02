import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// F6 (security-audit-2026-06-02 Sub-PR 3) — the proxy.ts CSP fallback
// path used to silently console.error and return a no-CSP response. We
// now ALSO emit `Sentry.captureException(err, { tags: { surface:
// 'csp-fallback' } })` so the operator gets the same signal in the
// Sentry alert stream that already paged them for app errors.

// Mocks must register before importing proxy.ts.
const captureExceptionMock = vi.fn()
const generateNonceMock = vi.fn()
const assembleCspMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  captureException: captureExceptionMock,
}))

vi.mock('@/lib/security/csp', () => ({
  generateNonce: generateNonceMock,
  assembleCsp: assembleCspMock,
}))

function buildRequest(): import('next/server').NextRequest {
  // The real NextRequest is heavy; the proxy only reads `request.headers`,
  // so a structurally-compatible object is enough.
  return new Request('http://localhost:3000/some/path', {
    method: 'GET',
  }) as unknown as import('next/server').NextRequest
}

describe('proxy CSP fallback — Sentry capture (F6)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    captureExceptionMock.mockReset()
    generateNonceMock.mockReset()
    assembleCspMock.mockReset()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.resetModules()
  })

  it('captures the error to Sentry with surface: csp-fallback tag when assembleCsp throws', async () => {
    const boom = new Error('csp construction failed (synthetic)')
    generateNonceMock.mockReturnValue('test-nonce')
    assembleCspMock.mockImplementation(() => {
      throw boom
    })

    const { proxy } = await import('@/proxy')
    const response = proxy(buildRequest())

    // Existing behaviour preserved: response returned, no CSP header.
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
    // console.error still fires as the journald backstop.
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // New F6 behaviour: Sentry captures the original error with the
    // `surface: csp-fallback` tag.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [capturedErr, captureContext] = captureExceptionMock.mock.calls[0]
    expect(capturedErr).toBe(boom)
    expect(captureContext).toEqual({ tags: { surface: 'csp-fallback' } })
  })

  it('captures the error when generateNonce throws (covers both CSP setup paths)', async () => {
    const boom = new Error('nonce generation failed (synthetic)')
    generateNonceMock.mockImplementation(() => {
      throw boom
    })

    const { proxy } = await import('@/proxy')
    proxy(buildRequest())

    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    expect(captureExceptionMock.mock.calls[0][0]).toBe(boom)
    expect(captureExceptionMock.mock.calls[0][1]).toEqual({
      tags: { surface: 'csp-fallback' },
    })
  })

  it('does NOT call Sentry on the happy path', async () => {
    generateNonceMock.mockReturnValue('happy-nonce')
    assembleCspMock.mockReturnValue("default-src 'self'")

    const { proxy } = await import('@/proxy')
    const response = proxy(buildRequest())

    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'self'",
    )
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('does not re-throw if Sentry itself throws (proxy stays resilient)', async () => {
    const boom = new Error('csp failure')
    generateNonceMock.mockReturnValue('nonce')
    assembleCspMock.mockImplementation(() => {
      throw boom
    })
    captureExceptionMock.mockImplementation(() => {
      throw new Error('Sentry network down')
    })

    const { proxy } = await import('@/proxy')
    expect(() => proxy(buildRequest())).not.toThrow()
  })
})
