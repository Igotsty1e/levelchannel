// Reduced-motion guard per docs/design-system.md §8.LANDING.8.
// All landing-v2 motion primitives consult this before attaching handlers.

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function onReducedMotionChange(handler: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  const listener = (e: MediaQueryListEvent) => handler(e.matches)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}
