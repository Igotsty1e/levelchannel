'use client'

import { motion, useScroll, useSpring } from 'framer-motion'

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 22,
    mass: 0.3,
  })

  return (
    <div className="v4-progress" aria-hidden>
      <motion.div className="v4-progress__bar" style={{ scaleX }} />
    </div>
  )
}
