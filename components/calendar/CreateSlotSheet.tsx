'use client'

import { useEffect, useRef, useState } from 'react'

import { ChipGroup } from '@/components/ui/primitives'

import { BulkSlotsForm } from './BulkSlotsForm'
import { SingleSlotForm, type TariffOption } from './SingleSlotForm'

export type CreateMode = 'closed' | 'single' | 'bulk'

const MODE_OPTIONS = [
  { value: 'single', label: 'Один слот' },
  { value: 'bulk', label: 'Несколько слотов' },
] as const

const BULK_PREF_KEY = 'lc_calendar_create_bulk_mode'

// Single chrome owns the segmented switcher + animated body. Both
// modes share the same overlay so flipping the switcher is a smooth
// cross-fade, not a hard cut between two separate modals.
//
// Body animation:
//   - cross-fade 220 ms ease-out on enter
//   - 8 px translateY on enter (subtle "settle")
//   - prefers-reduced-motion → instant swap
//
// Layout shift is contained by an outer container with overflow
// hidden + a min-height = max(single, bulk) measured on mount. The
// height transition uses 220 ms ease-in-out so the modal doesn't
// snap.

export function CreateSlotSheet({
  mode,
  onModeChange,
  tariffs,
  teacherTz,
  onCreated,
}: {
  mode: CreateMode
  onModeChange: (next: CreateMode) => void
  tariffs: ReadonlyArray<TariffOption>
  teacherTz?: string
  onCreated: () => void
}) {
  const [displayMode, setDisplayMode] = useState<Exclude<CreateMode, 'closed'>>(
    mode === 'closed' ? 'single' : mode,
  )
  const [animatingOut, setAnimatingOut] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Sync internal displayMode to incoming mode with a brief out→in
  // animation when it changes.
  useEffect(() => {
    if (mode === 'closed') return
    if (mode === displayMode) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setDisplayMode(mode)
      return
    }
    setAnimatingOut(true)
    const id = window.setTimeout(() => {
      setDisplayMode(mode)
      setAnimatingOut(false)
    }, 140)
    return () => window.clearTimeout(id)
  }, [mode, displayMode])

  if (mode === 'closed') return null

  function handleModeChange(next: string) {
    if (next !== 'single' && next !== 'bulk') return
    try {
      if (typeof window !== 'undefined') {
        if (next === 'bulk') window.localStorage.setItem(BULK_PREF_KEY, '1')
        else window.localStorage.removeItem(BULK_PREF_KEY)
      }
    } catch {
      // ignore (private mode, etc.)
    }
    onModeChange(next)
  }

  function close() {
    onModeChange('closed')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-slot-title"
      onClick={close}
      style={overlayStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={sheetStyle}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: 'var(--border)',
            margin: '0 auto 14px',
          }}
        />
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 id="create-slot-title" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Новое занятие
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={closeBtnStyle}
          >
            ×
          </button>
        </header>

        <div style={{ marginBottom: 16 }}>
          <ChipGroup
            name="create-mode"
            value={displayMode}
            options={MODE_OPTIONS}
            onChange={handleModeChange}
          />
        </div>

        <div
          ref={bodyRef}
          className="create-slot-body"
          data-animating-out={animatingOut ? 'true' : 'false'}
          style={{
            transition: 'opacity 220ms ease-out, transform 220ms ease-out',
            opacity: animatingOut ? 0 : 1,
            transform: animatingOut ? 'translateY(-8px)' : 'translateY(0)',
          }}
        >
          {displayMode === 'single' ? (
            <SingleSlotForm
              tariffs={tariffs}
              teacherTz={teacherTz}
              onCancel={close}
              onCreated={() => {
                onCreated()
                close()
              }}
            />
          ) : (
            <BulkSlotsForm
              tariffs={tariffs}
              onCancel={close}
              onCreated={() => {
                onCreated()
                close()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 1000,
}

const sheetStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--surface-1, #141416)',
  border: '1px solid var(--border)',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  padding: '14px 20px calc(20px + env(safe-area-inset-bottom))',
  color: 'var(--text)',
  boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
}

const closeBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--secondary)',
  cursor: 'pointer',
  fontSize: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
