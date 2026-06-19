/**
 * LevelChannel icon library (2026-06-18).
 *
 * Inline SVG glyphs для cabinet/teacher nav и других мест где сейчас
 * хардкодятся Unicode-emoji (⌂ ▦ ≡ ⚙). 24×24 viewbox, stroke=2,
 * currentColor — наследуют цвет от родителя, размер через size prop.
 *
 * Дизайн в стиле lucide/feather (line-icons, 2px stroke, rounded
 * caps/joins). Не тащим внешнюю библиотеку — это 6 SVG в 60 строк.
 *
 * Использование:
 *   import { HomeIcon } from '@/components/ui/icons'
 *   <HomeIcon size={24} />          // mobile nav
 *   <HomeIcon size={16} />          // inline в кнопках
 */

import type { SVGProps } from 'react'

type IconProps = {
  size?: number
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill'>

function svgProps(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
}

export function HomeIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}

export function CalendarIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  )
}

export function LessonsIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  )
}

export function LearnersIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 20c0-2.3 1.2-4.3 3-5.5" />
    </svg>
  )
}

export function PackagesIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <path d="M12 2L3 7v10l9 5 9-5V7z" />
      <path d="M3 7l9 5 9-5" />
      <path d="M12 12v10" />
    </svg>
  )
}

export function GearIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

// post-deploy bug bash 2026-06-19 (Bug 5A): SettingsCog — крупная,
// заметная иконка для отдельной точки входа в настройки. stroke-width=2.5
// для большей видимости; 8 зубцов вместо overflow-y лучше читается на
// маленьких экранах. Touch-target обеспечивается обёрткой в nav (min 44×44).
export function SettingsCogIcon({ size = 28, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 1.5v3.5" />
      <path d="M12 19v3.5" />
      <path d="M1.5 12h3.5" />
      <path d="M19 12h3.5" />
      <path d="M4.6 4.6l2.5 2.5" />
      <path d="M16.9 16.9l2.5 2.5" />
      <path d="M4.6 19.4l2.5-2.5" />
      <path d="M16.9 7.1l2.5-2.5" />
    </svg>
  )
}

// String-enum → component lookup, чтобы NAV_ITEMS могли хранить
// строковое имя и не таскать React-узлы по конфигам.
export type NavIconName =
  | 'home'
  | 'calendar'
  | 'lessons'
  | 'learners'
  | 'packages'
  | 'gear'
  | 'settings-cog'

export function NavIcon({
  name,
  size = 24,
  ...rest
}: { name: NavIconName } & IconProps) {
  switch (name) {
    case 'home':
      return <HomeIcon size={size} {...rest} />
    case 'calendar':
      return <CalendarIcon size={size} {...rest} />
    case 'lessons':
      return <LessonsIcon size={size} {...rest} />
    case 'learners':
      return <LearnersIcon size={size} {...rest} />
    case 'packages':
      return <PackagesIcon size={size} {...rest} />
    case 'gear':
      return <GearIcon size={size} {...rest} />
    case 'settings-cog':
      return <SettingsCogIcon size={size} {...rest} />
  }
}
