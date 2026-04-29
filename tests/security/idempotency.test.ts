import { describe, expect, it, vi } from 'vitest'

import { withIdempotency } from '@/lib/security/idempotency'

function makeRequest(headers: Record<string, string>) {
  return new Request('http://localhost/api/payments', {
    method: 'POST',
    headers,
  })
}

describe('withIdempotency (file backend = no-op cache)', () => {
  it('runs executor when no Idempotency-Key header', async () => {
    const executor = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    const response = await withIdempotency(
      makeRequest({}),
      'test:scope',
      '{"a":1}',
      executor,
    )
    expect(executor).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotency-Replay')).toBeNull()
  })

  it('rejects too short Idempotency-Key (under 8 chars)', async () => {
    const executor = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    const response = await withIdempotency(
      makeRequest({ 'idempotency-key': 'abc12' }),
      'test:scope',
      '{}',
      executor,
    )
    expect(response.status).toBe(400)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects key with disallowed characters', async () => {
    const executor = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    const response = await withIdempotency(
      makeRequest({ 'idempotency-key': 'abc def with spaces' }),
      'test:scope',
      '{}',
      executor,
    )
    expect(response.status).toBe(400)
    expect(executor).not.toHaveBeenCalled()
  })

  it('runs executor under file backend even with valid key', async () => {
    const executor = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    const response = await withIdempotency(
      makeRequest({ 'idempotency-key': 'abcdef12345678' }),
      'test:scope',
      '{"a":1}',
      executor,
    )
    expect(response.status).toBe(200)
    expect(executor).toHaveBeenCalledOnce()
  })

  it('passes through executor non-2xx outcomes (e.g. 400 invalid input)', async () => {
    const response = await withIdempotency(
      makeRequest({}),
      'test:scope',
      '{}',
      async () => ({ status: 400, body: { error: 'Bad' } }),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Bad')
  })
})
