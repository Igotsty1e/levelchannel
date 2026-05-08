'use client'

import { useState } from 'react'

import { SlotCalendar } from '@/components/calendar/SlotCalendar'

import { SlotCancelModal } from './slot-cancel-modal'
import { SlotsManager } from './slots-manager'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A PR3 — adds a Calendar tab alongside the existing list view.
// List stays the default tab (no regression for operators using list-
// view advanced ops: lifecycle marking, status filtering, operator-
// as-learner booking, delete-open). Calendar = additive surface for
// quick weekly overview + cancel via click.

export type SlotsViewSwitcherProps = {
  teachers: Array<{ id: string; email: string }>
  initialSlots: React.ComponentProps<typeof SlotsManager>['initialSlots']
  initialTariffs: React.ComponentProps<typeof SlotsManager>['initialTariffs']
  initialLearners: React.ComponentProps<typeof SlotsManager>['initialLearners']
}

export function SlotsViewSwitcher(props: SlotsViewSwitcherProps) {
  const [tab, setTab] = useState<'list' | 'calendar'>('list')
  const [calendarTeacherId, setCalendarTeacherId] = useState<string>(
    props.teachers[0]?.id ?? '',
  )
  const [activeRow, setActiveRow] = useState<CalendarRow | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)

  return (
    <div>
      <div
        role="tablist"
        aria-label="Вид слотов"
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <TabButton active={tab === 'list'} onClick={() => setTab('list')}>
          Список
        </TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
          Календарь
        </TabButton>
      </div>

      {tab === 'list' ? (
        <SlotsManager
          initialTeachers={props.teachers}
          initialSlots={props.initialSlots}
          initialTariffs={props.initialTariffs}
          initialLearners={props.initialLearners}
        />
      ) : (
        <div>
          {props.teachers.length === 0 ? (
            <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
              Нет учителей в системе.
            </p>
          ) : (
            <>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                  fontSize: 13,
                  color: 'var(--secondary)',
                }}
              >
                Учитель:
                <select
                  value={calendarTeacherId}
                  onChange={(e) => setCalendarTeacherId(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    color: '#e4e4e7',
                    fontSize: 13,
                  }}
                >
                  {props.teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.email}
                    </option>
                  ))}
                </select>
              </label>
              <SlotCalendar
                key={`${calendarTeacherId}-${reloadCounter}`}
                teacherId={calendarTeacherId}
                initialFromYmd={currentMondayYmd()}
                onSlotClick={(row) => setActiveRow(row)}
              />
            </>
          )}
        </div>
      )}

      {activeRow ? (
        <SlotCancelModal
          row={activeRow}
          onClose={() => setActiveRow(null)}
          onCancelled={() => {
            setActiveRow(null)
            // Force calendar refetch after mutation per Codex round 4
            // stale-state UX: increment key forces SlotCalendar to
            // remount + refetch.
            setReloadCounter((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: 14,
        background: active ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 6,
        color: active ? '#bfdbfe' : '#e4e4e7',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}

function currentMondayYmd(): string {
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(now)
  let y = 0, m = 0, d = 0, weekday = ''
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value)
    if (p.type === 'month') m = Number(p.value)
    if (p.type === 'day') d = Number(p.value)
    if (p.type === 'weekday') weekday = p.value
  }
  const dowMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  }
  const offset = dowMap[weekday] ?? 0
  const monday = new Date(Date.UTC(y, m - 1, d - offset))
  return monday.toISOString().slice(0, 10)
}
