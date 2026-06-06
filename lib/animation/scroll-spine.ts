// Scroll-trigger primitive per docs/design-system.md §8.LANDING.3.
// Single shared IntersectionObserver per page; adds `is-visible` once
// (never removes) to elements carrying `[data-scroll-trigger]`. Children
// inherit per-nth-child stagger via CSS transition-delay.
//
// Used by all 3 landing-v2 variants. Returns cleanup function — Lenis-
// provider equivalent contract (round-2 WARN #8 closure: explicit cleanup).

import { prefersReducedMotion } from './reduced-motion'

export type ScrollSpineCleanup = () => void

export function attachScrollSpine(root: HTMLElement | Document = document): ScrollSpineCleanup {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return () => {}
  }
  if (prefersReducedMotion()) {
    // Static fallback: mark every trigger visible immediately, no observer.
    root.querySelectorAll<HTMLElement>('[data-scroll-trigger]').forEach((el) => {
      el.classList.add('is-visible')
    })
    return () => {}
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.25, rootMargin: '0px 0px -25% 0px' }
  )

  const targets = root.querySelectorAll<HTMLElement>('[data-scroll-trigger]')
  targets.forEach((el) => observer.observe(el))

  return () => observer.disconnect()
}
