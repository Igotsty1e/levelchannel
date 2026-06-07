'use client'

import Link from 'next/link'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

// Cabinet button primitive — covers 95% of cases (CTA, secondary, danger,
// ghost). When you reach for inline `<button style={{...}}>` again, stop:
// extend this with a new variant first.

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

type CommonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  fullWidth?: boolean
  children: ReactNode
}

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined
  }

type AsLink = CommonProps & {
  href: string
  type?: never
  onClick?: never
  disabled?: boolean
  'aria-label'?: string
  title?: string
  target?: '_blank' | '_self' | '_parent' | '_top'
  rel?: string
}

export type ButtonProps = AsButton | AsLink

const PADDING_BY_SIZE: Record<ButtonSize, string> = {
  sm: '6px 12px',
  md: '8px 16px',
  lg: '10px 20px',
}

const FONT_BY_SIZE: Record<ButtonSize, number> = {
  sm: 13,
  md: 14,
  lg: 15,
}

const HEIGHT_BY_SIZE: Record<ButtonSize, number> = {
  sm: 32,
  md: 38,
  lg: 44,
}

function variantStyle(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--accent, #D88A82)',
        border: '1px solid var(--accent, #D88A82)',
        color: 'var(--text-on-accent, #FFFFFF)',
      }
    case 'secondary':
      return {
        background: 'var(--surface-2, rgba(255,255,255,0.05))',
        border: '1px solid var(--border)',
        color: 'var(--text)',
      }
    case 'danger':
      return {
        background: 'var(--danger, #FF6E6E)',
        border: '1px solid var(--danger, #FF6E6E)',
        color: '#FFFFFF',
      }
    case 'ghost':
      return {
        background: 'transparent',
        border: '1px solid transparent',
        color: 'var(--text)',
      }
  }
}

function buildStyle({
  variant,
  size,
  fullWidth,
}: {
  variant: ButtonVariant
  size: ButtonSize
  fullWidth: boolean
}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: PADDING_BY_SIZE[size],
    minHeight: HEIGHT_BY_SIZE[size],
    fontSize: FONT_BY_SIZE[size],
    fontWeight: 600,
    lineHeight: 1.2,
    borderRadius: 8,
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
    width: fullWidth ? '100%' : undefined,
    boxSizing: 'border-box',
    ...variantStyle(variant),
  }
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = 'primary',
      size = 'md',
      iconLeft,
      iconRight,
      loading = false,
      fullWidth = false,
      children,
      ...rest
    } = props
    const style = buildStyle({ variant, size, fullWidth })
    const inner = (
      <>
        {iconLeft ? <span aria-hidden="true">{iconLeft}</span> : null}
        <span>{children}</span>
        {iconRight ? <span aria-hidden="true">{iconRight}</span> : null}
      </>
    )

    if ('href' in rest && rest.href) {
      const { href, disabled, ...linkProps } = rest
      if (disabled) {
        return (
          <span
            ref={ref as React.Ref<HTMLAnchorElement>}
            aria-disabled="true"
            style={{ ...style, opacity: 0.5, pointerEvents: 'none' }}
          >
            {inner}
          </span>
        )
      }
      return (
        <Link
          {...linkProps}
          href={href}
          ref={ref as React.Ref<HTMLAnchorElement>}
          style={style}
        >
          {inner}
        </Link>
      )
    }
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>
    return (
      <button
        {...buttonProps}
        ref={ref as React.Ref<HTMLButtonElement>}
        style={{
          ...style,
          opacity: buttonProps.disabled || loading ? 0.6 : 1,
          cursor: buttonProps.disabled || loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '…' : inner}
      </button>
    )
  },
)
