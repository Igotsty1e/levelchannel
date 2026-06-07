// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildClientSessionId, recordLandingEvent } from '@/lib/landing/analytics-events'

describe('lib/landing/analytics-events', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 jsdom test',
      sendBeacon: vi.fn().mockReturnValue(true),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('buildClientSessionId is stable per UA + day', () => {
    const a = buildClientSessionId()
    const b = buildClientSessionId()
    expect(a).toBe(b)
    expect(a).toMatch(/^c[0-9a-z]+$/)
  })

  it('recordLandingEvent calls sendBeacon when available', () => {
    recordLandingEvent({ variantId: 'v2-a', sessionId: 'test', sectionSeen: 'hero' })
    expect((navigator.sendBeacon as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '/api/landing/event',
      expect.any(Blob)
    )
  })

  it('recordLandingEvent never throws on malformed payload', () => {
    expect(() =>
      recordLandingEvent({
        variantId: 'v2-b',
        sessionId: 'x',
        scrollDepthPct: 50,
      })
    ).not.toThrow()
  })
})
