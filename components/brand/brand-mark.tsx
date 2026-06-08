/**
 * BrandMark — единый брендовый знак LevelChannel.
 *
 * Sub-B.1 of saas-offer-and-landing-redesign plan-doc. Owner picked
 * Option O v6: ascending sine wave (path "M 0 0 Q 8 -14 16 0 T 32 0
 * T 48 0" rotated -28° around the start point, two endpoint dots,
 * vertically centered with the "LevelChannel" wordmark). Replaces all
 * inline `<L>` instances per Q-B.5 = Option A (single brand) scope.
 *
 * - `variant`: 'full' (mark + wordmark) | 'mark' (mark only — for
 *   favicons, OG, compact headers).
 * - `width`: render width in CSS pixels. Mark width grows proportionally.
 * - `wordmarkClassName`: optional override for the wordmark span text
 *   classes (e.g. set color in light/dark contexts).
 *
 * No animation in this component — the static mark renders fast on
 * every header. For the hero entrance animation, use the dedicated
 * `<BrandMarkAnimated />` (Sub-B.3) on the `/saas` landing only.
 */

import type { CSSProperties } from 'react'

export type BrandMarkProps = {
  variant?: 'full' | 'mark'
  width?: number
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

export function BrandMark({
  variant = 'full',
  width,
  className,
  style,
  ariaLabel = 'LevelChannel',
}: BrandMarkProps) {
  if (variant === 'mark') {
    const w = width ?? 32
    return (
      <svg
        width={w}
        height={w}
        viewBox="0 0 80 80"
        role="img"
        aria-label={ariaLabel}
        className={className}
        style={style}
      >
        <defs>
          <linearGradient
            id="brand-mark-grad"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="80"
            x2="80"
            y2="0"
          >
            <stop offset="0%" stopColor="#C87878" />
            <stop offset="100%" stopColor="#E8A890" />
          </linearGradient>
        </defs>
        <g
          transform="translate(6,66) rotate(-28)"
          stroke="url(#brand-mark-grad)"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M 0 0 Q 12 -22 24 0 T 48 0 T 72 0"
            strokeWidth="6"
          />
          <circle
            cx="0"
            cy="0"
            r="6"
            fill="url(#brand-mark-grad)"
            stroke="none"
          />
          <circle
            cx="72"
            cy="0"
            r="6"
            fill="url(#brand-mark-grad)"
            stroke="none"
          />
        </g>
      </svg>
    )
  }

  const w = width ?? 200
  const h = w * (80 / 320)
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 320 80"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={style}
    >
      <defs>
        {/* userSpaceOnUse — иначе градиент в tspan не резолвится на iOS Safari */}
        <linearGradient
          id="brand-full-grad"
          gradientUnits="userSpaceOnUse"
          x1="72"
          y1="60"
          x2="300"
          y2="20"
        >
          <stop offset="0%" stopColor="#C87878" />
          <stop offset="100%" stopColor="#E8A890" />
        </linearGradient>
      </defs>
      <g
        transform="translate(12,52) rotate(-28)"
        stroke="url(#brand-full-grad)"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 0 0 Q 8 -14 16 0 T 32 0 T 48 0" strokeWidth="3" />
        <circle
          cx="0"
          cy="0"
          r="3.4"
          fill="url(#brand-full-grad)"
          stroke="none"
        />
        <circle
          cx="48"
          cy="0"
          r="3.4"
          fill="url(#brand-full-grad)"
          stroke="none"
        />
      </g>
      <text
        x="72"
        y="50"
        fontFamily="Inter, -apple-system, sans-serif"
        fontSize="28"
        fontWeight="700"
        letterSpacing="-0.02em"
        fill="currentColor"
      >
        <tspan>Level</tspan>
        <tspan fill="url(#brand-full-grad)" fontWeight="800">
          Channel
        </tspan>
      </text>
    </svg>
  )
}
