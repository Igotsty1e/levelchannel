'use client'
// Aceternity UI — Aurora Background.
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function AuroraBackground({
  className,
  children,
  showRadialGradient = true,
}: {
  className?: string
  children?: ReactNode
  showRadialGradient?: boolean
}) {
  return (
    <div className={cn('relative flex flex-col items-center justify-center bg-[#0B0B0C] text-slate-50', className)}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={cn(
            'pointer-events-none absolute -inset-[10px] opacity-50 blur-[10px] filter will-change-transform',
            "[--white-gradient:repeating-linear-gradient(100deg,#F5F5F7_0%,#F5F5F7_7%,transparent_10%,transparent_12%,#F5F5F7_16%)]",
            "[--dark-gradient:repeating-linear-gradient(100deg,#0B0B0C_0%,#0B0B0C_7%,transparent_10%,transparent_12%,#0B0B0C_16%)]",
            "[--aurora:repeating-linear-gradient(100deg,#C87878_10%,#E8A890_15%,#C87878_20%,#E8A890_25%,#C87878_30%)]",
            "[background-image:var(--dark-gradient),var(--aurora)] [background-size:300%,_200%] [background-position:50%_50%,50%_50%]",
            "after:absolute after:inset-0 after:content-[''] after:mix-blend-difference",
            'after:[background-image:var(--dark-gradient),var(--aurora)] after:[background-size:200%,_100%] after:[background-attachment:fixed] after:animate-aurora',
            showRadialGradient &&
              '[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,transparent_70%)]',
          )}
        />
      </div>
      {children}
    </div>
  )
}
