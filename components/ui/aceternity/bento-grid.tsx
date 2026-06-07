'use client'
// Aceternity UI — Bento Grid (responsive bento layout).
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function BentoGrid({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto grid max-w-7xl grid-cols-1 gap-4 md:auto-rows-[20rem] md:grid-cols-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function BentoGridItem({
  className,
  title,
  description,
  header,
  icon,
}: {
  className?: string
  title?: string | ReactNode
  description?: string | ReactNode
  header?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div
      className={cn(
        'group/bento row-span-1 flex flex-col justify-between space-y-4 rounded-xl border border-white/10 bg-[#111113] p-5 shadow-input transition duration-200 hover:bg-[#16161A]',
        className,
      )}
    >
      {header}
      <div className="transition duration-200 group-hover/bento:translate-x-2">
        {icon}
        <div className="mt-2 mb-2 font-sans text-lg font-bold text-[#F5F5F7]">
          {title}
        </div>
        <div className="font-sans text-sm font-normal leading-relaxed text-[#A1A1AA]">
          {description}
        </div>
      </div>
    </div>
  )
}
