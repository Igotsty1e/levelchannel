import { createHmac } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildCheckoutTelemetryEvent } from '@/lib/telemetry/store'

describe('buildCheckoutTelemetryEvent', () => {
  afterEach(() => {
    delete process.env.TELEMETRY_HASH_SECRET
    vi.restoreAllMocks()
  })

  it('omits emailHash when TELEMETRY_HASH_SECRET is unset', () => {
    delete process.env.TELEMETRY_HASH_SECRET
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const event = buildCheckoutTelemetryEvent({
      type: 'order.created',
      email: 'User@Example.com',
    })

    expect(event.emailHash).toBeUndefined()
    expect(event.emailDomain).toBe('example.com')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('hashes the normalized email when TELEMETRY_HASH_SECRET is set', () => {
    process.env.TELEMETRY_HASH_SECRET = 'telemetry-test-secret'

    const event = buildCheckoutTelemetryEvent({
      type: 'order.created',
      email: 'User@Example.com',
    })

    const expected = createHmac('sha256', 'telemetry-test-secret')
      .update('user@example.com')
      .digest('hex')

    expect(event.emailHash).toBe(expected)
    expect(event.emailDomain).toBe('example.com')
  })
})
