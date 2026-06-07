'use client'

import { motion, useScroll, useSpring } from 'framer-motion'

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 110, damping: 30, restDelta: 0.001 })

  return (
    <motion.div
      className="landing-v3-scroll-bar"
      style={{ scaleX }}
      aria-hidden
    />
  )
}
