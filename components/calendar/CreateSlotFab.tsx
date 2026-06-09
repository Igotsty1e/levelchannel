'use client'

import { FloatingActionButton } from '@/components/ui/primitives'

import type { CreateMode } from './CreateSlotSheet'

const BULK_PREF_KEY = 'lc_calendar_create_bulk_mode'

// Floating-action button — mobile-only entry point to the
// CreateSlotSheet. On tap we read the persisted bulk-preference and
// open the sheet in the user's last-used mode.
//
// Visibility: the FAB itself is hidden on ≥600px via the
// `.calendar-mobile-fab` class (rule lives in app/globals.css).

export function CreateSlotFab({
  onOpen,
}: {
  onOpen: (mode: Exclude<CreateMode, 'closed'>) => void
}) {
  function handleClick() {
    let mode: Exclude<CreateMode, 'closed'> = 'single'
    try {
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem(BULK_PREF_KEY) === '1'
      ) {
        mode = 'bulk'
      }
    } catch {
      // ignore (private mode, etc.)
    }
    onOpen(mode)
  }

  return (
    <div className="calendar-mobile-fab">
      <FloatingActionButton label="Создать" onClick={handleClick} />
    </div>
  )
}
