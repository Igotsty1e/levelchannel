import Link from 'next/link'
import type { ReactNode } from 'react'

import { Pill, type PillTone } from '@/components/ui/primitives'

// teacher/settings hub tile (2026-06-07 → 2026-06-10).
// Один тайл = одна sub-страница раздела «Настройки» (профиль / цены /
// пакеты / подписка / интеграции / уведомления / приём оплат).
// Иконка живёт в accent-tinted chip, title + опциональный status-pill
// ИЛИ icon-indicator (взаимно исключающие).

type SettingsTileBase = {
  href: string
  icon: ReactNode
  title: string
}

// Discriminated union — `status` и `indicator` enforced exclusive at compile time.
type SettingsTileVariant =
  | { status?: undefined; indicator?: undefined }
  | { status: { label: string; tone: PillTone }; indicator?: undefined }
  | { status?: undefined; indicator: 'connected' | 'not-connected' }

export type SettingsTileProps = SettingsTileBase & SettingsTileVariant

export function SettingsTile(props: SettingsTileProps) {
  const { href, icon, title } = props
  return (
    <Link href={href} className="settings-tile">
      <span aria-hidden="true" className="settings-tile-icon">
        {icon}
      </span>
      <div className="settings-tile-body">
        <span className="settings-tile-title">{title}</span>
        {props.status ? (
          <Pill tone={props.status.tone} size="sm">
            {props.status.label}
          </Pill>
        ) : null}
        {props.indicator ? <ConnectionIndicator state={props.indicator} /> : null}
      </div>
    </Link>
  )
}

function ConnectionIndicator({ state }: { state: 'connected' | 'not-connected' }) {
  const label = state === 'connected' ? 'Подключено' : 'Не подключено'
  return (
    <span
      className={`settings-tile-indicator settings-tile-indicator--${state}`}
      aria-label={label}
      role="img"
    >
      {state === 'connected' ? <CheckGlyph /> : <CrossGlyph />}
    </span>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 6.5" />
    </svg>
  )
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 6.5l11 11" />
      <path d="M6.5 17.5l11-11" />
    </svg>
  )
}
