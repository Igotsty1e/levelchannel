// landing-v2 animation primitives entry — exported per docs/design-system.md §8.LANDING.
//
// Per round-2 BLOCKER #2 closure: NO segment-level layout edit. Primitives
// are exported; per-variant page mounts wire them via useEffect with explicit
// cleanup. Cleanup order: attach* returns disposer → useEffect returns disposer.

export { prefersReducedMotion, onReducedMotionChange } from './reduced-motion'
export { attachScrollSpine } from './scroll-spine'
export { attachMagneticCursor } from './magnetic-cursor'
export { attachParallax } from './parallax'
export { attachTilt } from './tilt'

export type { ScrollSpineCleanup } from './scroll-spine'
export type { MagneticCleanup } from './magnetic-cursor'
export type { ParallaxCleanup } from './parallax'
export type { TiltCleanup } from './tilt'
