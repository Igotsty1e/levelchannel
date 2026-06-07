'use client'
// Aceternity UI — Text Generate Effect: words appear staggered.
import { motion, stagger, useAnimate } from 'framer-motion'
import { useEffect } from 'react'

import { cn } from '@/lib/utils'

export function TextGenerateEffect({
  words,
  className,
  filter = true,
  duration = 0.6,
}: {
  words: string
  className?: string
  filter?: boolean
  duration?: number
}) {
  const [scope, animate] = useAnimate()
  const wordsArray = words.split(' ')
  useEffect(() => {
    animate(
      'span',
      {
        opacity: 1,
        filter: filter ? 'blur(0px)' : 'none',
      },
      {
        duration,
        delay: stagger(0.12),
      },
    )
  }, [animate, filter, duration])
  return (
    <motion.div ref={scope} className={cn(className)}>
      {wordsArray.map((word, idx) => (
        <motion.span
          key={`${word}-${idx}`}
          className="opacity-0"
          style={{ filter: filter ? 'blur(10px)' : 'none' }}
        >
          {word}{' '}
        </motion.span>
      ))}
    </motion.div>
  )
}
