'use client'
// Aceternity UI — Background Beams (open-source component, adapted for LevelChannel landing-v3).
// Source pattern: https://ui.aceternity.com/components/background-beams
import { motion } from 'framer-motion'
import { useId } from 'react'

import { cn } from '@/lib/utils'

export function BackgroundBeams({ className }: { className?: string }) {
  const id = useId()
  const paths = [
    'M-380 -189 C-380 -189 -312 216 152 343 C616 470 684 875 684 875',
    'M-373 -197 C-373 -197 -305 208 159 335 C623 462 691 867 691 867',
    'M-366 -205 C-366 -205 -298 200 166 327 C630 454 698 859 698 859',
    'M-359 -213 C-359 -213 -291 192 173 319 C637 446 705 851 705 851',
    'M-352 -221 C-352 -221 -284 184 180 311 C644 438 712 843 712 843',
    'M-345 -229 C-345 -229 -277 176 187 303 C651 430 719 835 719 835',
    'M-338 -237 C-338 -237 -270 168 194 295 C658 422 726 827 726 827',
    'M-331 -245 C-331 -245 -263 160 201 287 C665 414 733 819 733 819',
    'M-324 -253 C-324 -253 -256 152 208 279 C672 406 740 811 740 811',
    'M-317 -261 C-317 -261 -249 144 215 271 C679 398 747 803 747 803',
  ]
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden [mask-image:radial-gradient(60%_50%_at_50%_50%,white_0%,transparent_100%)]',
        className,
      )}
    >
      <svg
        className="pointer-events-none absolute z-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {paths.map((path, index) => (
          <motion.path
            key={`path-${index}`}
            d={path}
            stroke={`url(#linearGradient-${id}-${index})`}
            strokeOpacity="0.4"
            strokeWidth="0.5"
          />
        ))}
        <defs>
          {paths.map((_, index) => (
            <motion.linearGradient
              id={`linearGradient-${id}-${index}`}
              key={`gradient-${index}`}
              initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
              animate={{
                x1: ['0%', '100%'],
                x2: ['0%', '95%'],
                y1: ['0%', '100%'],
                y2: ['0%', `${93 + Math.random() * 8}%`],
              }}
              transition={{
                duration: Math.random() * 10 + 10,
                ease: 'easeInOut',
                repeat: Infinity,
                delay: Math.random() * 10,
              }}
            >
              <stop stopColor="#C87878" stopOpacity="0" />
              <stop stopColor="#E8A890" />
              <stop offset="32.5%" stopColor="#C87878" />
              <stop offset="100%" stopColor="#C87878" stopOpacity="0" />
            </motion.linearGradient>
          ))}
        </defs>
      </svg>
    </div>
  )
}
