'use client'

// Per-variant motion mount. Per round-2 BLOCKER #2 closure: NO segment-level
// layout wrap. Each variant's leaf page wraps its content in <LandingMotion />
// and the wrapper attaches primitives on mount, returns cleanup disposers on
// unmount. Cleanup invariant tested in tests/landing-v2/landing-motion.test.tsx.

import { useEffect, type PropsWithChildren } from 'react'

import {
  attachMagneticCursor,
  attachParallax,
  attachScrollSpine,
  attachTilt,
} from '@/lib/animation'

type LandingMotionProps = PropsWithChildren<{
  variantId: 'v2-a' | 'v2-b' | 'v2-c'
  enableTilt?: boolean
  enableMagnetic?: boolean
  enableParallax?: boolean
}>

export function LandingMotion({
  children,
  variantId,
  enableTilt = false,
  enableMagnetic = false,
  enableParallax = false,
}: LandingMotionProps) {
  useEffect(() => {
    const disposers: Array<() => void> = []

    disposers.push(attachScrollSpine(document))
    if (enableMagnetic) disposers.push(attachMagneticCursor(document))
    if (enableTilt) disposers.push(attachTilt(document))
    if (enableParallax) disposers.push(attachParallax(document))

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [enableMagnetic, enableTilt, enableParallax])

  return (
    <div className="saas-chrome" data-landing-variant={variantId.slice(-1)}>
      {children}
    </div>
  )
}
