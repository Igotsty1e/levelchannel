// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { attachScrollSpine } from '@/lib/animation/scroll-spine'

describe('lib/animation/scroll-spine — attach + cleanup contract', () => {
  let observerInstances: Array<{ observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; callback: IntersectionObserverCallback }>
  let mockMql: { matches: boolean }

  let originalIO: typeof IntersectionObserver | undefined

  beforeEach(() => {
    observerInstances = []
    mockMql = { matches: false }
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(
        () =>
          ({
            matches: mockMql.matches,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList
      ),
    })
    originalIO = global.IntersectionObserver
    // @ts-expect-error mock global
    global.IntersectionObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      callback: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) {
        this.callback = cb
        observerInstances.push(this)
      }
    }
  })

  afterEach(() => {
    if (originalIO) {
      global.IntersectionObserver = originalIO
    }
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('attaches observer and disposes on cleanup', () => {
    document.body.innerHTML = '<div data-scroll-trigger></div><div data-scroll-trigger></div>'
    const dispose = attachScrollSpine(document)
    expect(observerInstances).toHaveLength(1)
    expect(observerInstances[0].observe).toHaveBeenCalledTimes(2)
    dispose()
    expect(observerInstances[0].disconnect).toHaveBeenCalled()
  })

  it('falls back to instant is-visible under prefers-reduced-motion', () => {
    mockMql.matches = true
    document.body.innerHTML = '<div data-scroll-trigger></div>'
    attachScrollSpine(document)
    const trigger = document.querySelector('[data-scroll-trigger]')!
    expect(trigger.classList.contains('is-visible')).toBe(true)
    expect(observerInstances).toHaveLength(0)
  })

  it('safe no-op when IntersectionObserver missing', () => {
    // @ts-expect-error simulate missing
    global.IntersectionObserver = undefined
    const dispose = attachScrollSpine(document)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})
