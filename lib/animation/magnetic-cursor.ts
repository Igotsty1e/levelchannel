// Magnetic cursor primitive per docs/design-system.md §8.LANDING.4.
// Single mousemove listener per magnetic element; cursor inside radius
// pulls element by 18% of distance. Spring settle on cursor leave.
//
// Desktop-only — `@media (hover: hover)` guard inline. Mobile reverts
// to plain CTA hit-target (round-1 R4 closure).

import { prefersReducedMotion } from './reduced-motion'

const MAGNETIC_STRENGTH = 0.18
const MAGNETIC_RADIUS_FALLBACK = 96
const MAGNETIC_MAX_DISP_FALLBACK = 12

export type MagneticCleanup = () => void

export function attachMagneticCursor(root: HTMLElement | Document = document): MagneticCleanup {
  if (typeof window === 'undefined') return () => {}
  if (prefersReducedMotion()) return () => {}
  if (!window.matchMedia('(hover: hover)').matches) return () => {}

  const cleanups: Array<() => void> = []
  const elements = root.querySelectorAll<HTMLElement>('[data-magnetic]')

  elements.forEach((el) => {
    const radius = parseInt(getComputedStyle(el).getPropertyValue('--magnetic-radius'), 10) || MAGNETIC_RADIUS_FALLBACK
    const maxDisp = parseInt(getComputedStyle(el).getPropertyValue('--magnetic-max-disp'), 10) || MAGNETIC_MAX_DISP_FALLBACK

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy)
      if (dist > radius) {
        if (el.classList.contains('is-following')) {
          el.classList.remove('is-following')
          el.style.transform = ''
        }
        return
      }
      el.classList.add('is-following')
      const tx = Math.max(-maxDisp, Math.min(maxDisp, dx * MAGNETIC_STRENGTH))
      const ty = Math.max(-maxDisp, Math.min(maxDisp, dy * MAGNETIC_STRENGTH))
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
    }

    const onLeave = () => {
      el.classList.remove('is-following')
      el.style.transform = ''
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    el.addEventListener('mouseleave', onLeave)

    cleanups.push(() => {
      window.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
      el.classList.remove('is-following')
      el.style.transform = ''
    })
  })

  return () => cleanups.forEach((fn) => fn())
}
