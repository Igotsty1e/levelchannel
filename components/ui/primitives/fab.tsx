'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Floating Action Button. Sticky bottom-right entry point on mobile —
// «one primary thing the user wants to do on this screen». Use only ONE
// FAB per screen.

export type FloatingActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  label: string // visible text next to icon, e.g. «Создать занятие»
  icon?: ReactNode
}

export function FloatingActionButton({
  label,
  icon = '+',
  style,
  className,
  ...rest
}: FloatingActionButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={rest['aria-label'] ?? label}
      className={['lc-fab', className].filter(Boolean).join(' ')}
      style={{
        position: 'fixed',
        right: 16,
        // Default bottom: clear iOS safe-area only. On mobile cabinet
        // surfaces with a bottom-nav, globals.css `.saas-chrome .lc-fab`
        // override lifts this above the nav. CSS wins via specificity.
        bottom: `calc(16px + env(safe-area-inset-bottom))`,
        zIndex: 50,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px',
        borderRadius: 999,
        border: 'none',
        background: 'var(--accent, #D88A82)',
        color: 'var(--text-on-accent, #FFFFFF)',
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1.2,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        cursor: 'pointer',
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}
