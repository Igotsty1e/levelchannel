'use client'
// Aceternity UI — Background Boxes (subtle 32x32 grid with hover glow).
import { motion } from 'framer-motion'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

export function BackgroundBoxes({ className }: { className?: string }) {
  const rows = useMemo(() => new Array(150).fill(1), [])
  const cols = useMemo(() => new Array(100).fill(1), [])
  const colors = ['#C87878', '#E8A890', '#F5F5F7', '#A1A1AA']

  return (
    <div
      style={{
        transform: 'translate(-40%,-60%) skewX(-48deg) skewY(14deg) scale(0.675) rotate(0deg) translateZ(0)',
      }}
      className={cn(
        'absolute -top-1/4 left-1/4 z-0 flex h-full w-full -translate-x-1/2 p-4',
        className,
      )}
    >
      {rows.map((_, i) => (
        <motion.div
          key={`row-${i}`}
          className="relative h-8 w-16 border-l border-slate-700/30"
        >
          {cols.map((_, j) => (
            <motion.div
              whileHover={{
                backgroundColor: colors[Math.floor(Math.random() * colors.length)],
                transition: { duration: 0 },
              }}
              animate={{
                transition: { duration: 2 },
              }}
              key={`col-${j}`}
              className="relative h-8 w-16 border-t border-r border-slate-700/30"
            >
              {j % 2 === 0 && i % 2 === 0 ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  className="pointer-events-none absolute -top-[14px] -left-[22px] h-6 w-10 stroke-[1px] text-slate-700/40"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                </svg>
              ) : null}
            </motion.div>
          ))}
        </motion.div>
      ))}
    </div>
  )
}
