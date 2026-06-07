// Parallax depth primitive per docs/design-system.md §8.LANDING.7.
// Single scroll listener (passive), requestAnimationFrame-throttled.
// Layers via `data-parallax="bg|mid|fg"` attribute.

import { prefersReducedMotion } from './reduced-motion'

const FACTORS: Record<string, number> = { bg: 0.3, mid: 0.6, fg: 0.9 }

export type ParallaxCleanup = () => void

export function attachParallax(root: HTMLElement | Document = document): ParallaxCleanup {
  if (typeof window === 'undefined') return () => {}
  if (prefersReducedMotion()) return () => {}

  const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-parallax]'))
  if (layers.length === 0) return () => {}

  let rafId: number | null = null
  let lastScrollY = window.scrollY

  const tick = () => {
    rafId = null
    for (const layer of layers) {
      const kind = layer.getAttribute('data-parallax') || 'mid'
      const factor = FACTORS[kind] ?? 0.6
      layer.style.transform = `translate3d(0, ${lastScrollY * factor * -0.15}px, 0)`
    }
  }

  const onScroll = () => {
    lastScrollY = window.scrollY
    if (rafId !== null) return
    rafId = requestAnimationFrame(tick)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  tick()

  return () => {
    window.removeEventListener('scroll', onScroll)
    if (rafId !== null) cancelAnimationFrame(rafId)
    for (const layer of layers) {
      layer.style.transform = ''
    }
  }
}
