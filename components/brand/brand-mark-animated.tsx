'use client'

/**
 * BrandMarkAnimated — анимированная версия знака для hero на /saas.
 *
 * Sub-B.3 of saas-offer-and-landing-redesign plan-doc (C2 Tier-1 polish).
 * Контракт анимации (см. memory `levelchannel_brand_mark_option_o.md`):
 *
 *   1. 0.0 → 0.3s: ОБА endpoint-точки появляются одновременно.
 *   2. 0.3 → 1.7s: ghost-trail (полупрозрачный) проводит линию между точками.
 *   3. 0.4 → 1.6s: основная path рисуется L → R.
 *   4. 1.7 → 2.3s: wordmark «LevelChannel» проявляется.
 *   5. 2.0s+: бесконечный мягкий pulse на обеих точках (3.6s цикл).
 *
 * Реализация — SMIL внутри SVG; никаких JS-зависимостей кроме
 * matchMedia для prefers-reduced-motion.
 *
 * C3 a11y closure (2026-05-31) — CSS `animation: none` НЕ управляет
 * SMIL `<animate>` элементами (SMIL живёт вне CSS animation engine).
 * Поэтому при `prefers-reduced-motion: reduce` мы рендерим статичный
 * `<BrandMark variant="full" />` вместо анимированной версии — это
 * единственный честный способ заглушить SMIL.
 */

import { useEffect, useState, type CSSProperties } from 'react'

import { BrandMark } from '@/components/brand/brand-mark'

export type BrandMarkAnimatedProps = {
  width?: number
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

export function BrandMarkAnimated({
  width = 320,
  className,
  style,
  ariaLabel = 'LevelChannel',
}: BrandMarkAnimatedProps) {
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // Safari < 14 fallback.
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])

  // Reduced-motion → static mark. SMIL не отключается через CSS, поэтому
  // единственный честный путь — рендерить незанимированную версию.
  if (reduceMotion) {
    return (
      <BrandMark
        variant="full"
        width={width}
        className={className}
        style={style}
        ariaLabel={ariaLabel}
      />
    )
  }

  const h = width * (80 / 320)
  return (
    <svg
      width={width}
      height={h}
      viewBox="0 0 320 80"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id="brand-anim-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#C87878" />
          <stop offset="100%" stopColor="#E8A890" />
        </linearGradient>
      </defs>
      <g
        transform="translate(12,52) rotate(-28)"
        stroke="url(#brand-anim-grad)"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Ghost trail — полупрозрачный straight line между точками,
           рисуется по второму такту (0.3 → 1.7s). */}
        <line
          className="brand-anim-ghost"
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          strokeWidth="1.2"
          stroke="url(#brand-anim-grad)"
          opacity="0"
          strokeDasharray="48"
          strokeDashoffset="48"
        >
          <animate
            attributeName="opacity"
            from="0"
            to="0.28"
            begin="0.3s"
            dur="0.4s"
            fill="freeze"
          />
          <animate
            attributeName="stroke-dashoffset"
            from="48"
            to="0"
            begin="0.3s"
            dur="1.4s"
            fill="freeze"
          />
        </line>

        {/* Основная sine-wave path — рисуется по третьему такту
           (0.4 → 1.6s). pathLength=100 нормализует длину. */}
        <path
          className="brand-anim-path"
          d="M 0 0 Q 8 -14 16 0 T 32 0 T 48 0"
          strokeWidth="3"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset="100"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="100"
            to="0"
            begin="0.4s"
            dur="1.2s"
            fill="freeze"
          />
        </path>

        {/* Левая точка — появляется с правой одновременно (0.0 → 0.3s),
           затем бесконечный pulse. */}
        <circle
          className="brand-anim-dot"
          cx="0"
          cy="0"
          r="3.4"
          fill="url(#brand-anim-grad)"
          stroke="none"
          opacity="0"
        >
          <animate
            attributeName="opacity"
            from="0"
            to="1"
            begin="0s"
            dur="0.3s"
            fill="freeze"
          />
          <animate
            attributeName="r"
            values="3.4;4.2;3.4"
            begin="2.0s"
            dur="3.6s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Правая точка — симметрично. */}
        <circle
          className="brand-anim-dot"
          cx="48"
          cy="0"
          r="3.4"
          fill="url(#brand-anim-grad)"
          stroke="none"
          opacity="0"
        >
          <animate
            attributeName="opacity"
            from="0"
            to="1"
            begin="0s"
            dur="0.3s"
            fill="freeze"
          />
          <animate
            attributeName="r"
            values="3.4;4.2;3.4"
            begin="2.0s"
            dur="3.6s"
            repeatCount="indefinite"
          />
        </circle>
      </g>
      {/* Wordmark — проявляется по четвёртому такту (1.7 → 2.3s). */}
      <text
        className="brand-anim-text"
        x="72"
        y="50"
        fontFamily="Inter, -apple-system, sans-serif"
        fontSize="28"
        fontWeight="700"
        letterSpacing="-0.02em"
        fill="currentColor"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          from="0"
          to="1"
          begin="1.7s"
          dur="0.6s"
          fill="freeze"
        />
        <tspan>Level</tspan>
        <tspan fill="url(#brand-anim-grad)" fontWeight="800">
          Channel
        </tspan>
      </text>
    </svg>
  )
}
