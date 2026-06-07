// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onReducedMotionChange, prefersReducedMotion } from '@/lib/animation/reduced-motion'

describe('lib/animation/reduced-motion', () => {
  let mockMql: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }
  let originalMatchMedia: typeof window.matchMedia | undefined

  beforeEach(() => {
    mockMql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => mockMql as unknown as MediaQueryList),
    })
  })

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      })
    }
    vi.restoreAllMocks()
  })

  it('returns true when matchMedia reports prefers-reduced-motion', () => {
    mockMql.matches = true
    expect(prefersReducedMotion()).toBe(true)
  })

  it('returns false when matchMedia reports no preference', () => {
    mockMql.matches = false
    expect(prefersReducedMotion()).toBe(false)
  })

  it('returns true when matchMedia is missing (safety fallback)', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    expect(prefersReducedMotion()).toBe(true)
  })

  it('onReducedMotionChange subscribes and returns disposer', () => {
    const handler = vi.fn()
    const dispose = onReducedMotionChange(handler)
    expect(mockMql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    dispose()
    expect(mockMql.removeEventListener).toHaveBeenCalled()
  })
})
