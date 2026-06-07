import Link from 'next/link'
import type { ReactNode } from 'react'

import { Pill, type PillTone } from '@/components/ui/primitives'

// teacher/settings hub tile (2026-06-07).
// Один тайл = одна sub-страница раздела «Настройки» (профиль / цены /
// пакеты / подписка / интеграции / уведомления / приём оплат).
// Иконка живёт в accent-tinted chip, title + опциональный status-pill.

export type SettingsTileProps = {
  href: string
  icon: ReactNode
  title: string
  status?: {
    label: string
    tone: PillTone
  }
}

export function SettingsTile({ href, icon, title, status }: SettingsTileProps) {
  return (
    <Link href={href} className="settings-tile">
      <span aria-hidden="true" className="settings-tile-icon">
        {icon}
      </span>
      <div className="settings-tile-body">
        <span className="settings-tile-title">{title}</span>
        {status ? (
          <Pill tone={status.tone} size="sm">
            {status.label}
          </Pill>
        ) : null}
      </div>
    </Link>
  )
}
