// 3D card tilt primitive per docs/design-system.md §8.LANDING.5.
// Cursor over `[data-tilt]` rotates `.tilt-inner` toward cursor.

import { prefersReducedMotion } from './reduced-motion'

const TILT_MAX_ROT_FALLBACK = 8

export type TiltCleanup = () => void

export function attachTilt(root: HTMLElement | Document = document): TiltCleanup {
  if (typeof window === 'undefined') return () => {}
  if (prefersReducedMotion()) return () => {}
  if (!window.matchMedia('(hover: hover)').matches) return () => {}

  const cleanups: Array<() => void> = []
  const cards = root.querySelectorAll<HTMLElement>('[data-tilt]')

  cards.forEach((card) => {
    const inner = card.querySelector<HTMLElement>('.tilt-inner') ?? card
    const maxRot = parseInt(getComputedStyle(card).getPropertyValue('--tilt-max-rot'), 10) || TILT_MAX_ROT_FALLBACK

    const onMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height
      const rotY = (px - 0.5) * 2 * maxRot
      const rotX = -(py - 0.5) * 2 * maxRot
      inner.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`
    }

    const onLeave = () => {
      inner.style.transform = ''
    }

    card.addEventListener('mousemove', onMove, { passive: true })
    card.addEventListener('mouseleave', onLeave)

    cleanups.push(() => {
      card.removeEventListener('mousemove', onMove)
      card.removeEventListener('mouseleave', onLeave)
      inner.style.transform = ''
    })
  })

  return () => cleanups.forEach((fn) => fn())
}
