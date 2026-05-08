'use client'

import { useState } from 'react'

import { PaintConfirmModal } from '@/components/calendar/PaintConfirmModal'
import { SlotCalendar } from '@/components/calendar/SlotCalendar'

import { SlotCancelModal } from './slot-cancel-modal'
import { SlotsManager } from './slots-manager'

import type { PaintSpan, MoveTarget } from '@/lib/calendar/drag-state'
import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A PR3 — adds a Calendar tab alongside the existing list view.
// List stays the default tab (no regression for operators using list-
// view advanced ops: lifecycle marking, status filtering, operator-
// as-learner booking, delete-open). Calendar = additive surface for
// quick weekly overview + cancel via click.
//
// PR3b — drag interactions on the operator calendar:
//   - drag empty cells → opens PaintConfirmModal → POST bulk-create
//   - drag open slot → PATCH /api/admin/slots/[id]/move
//   Both flows trigger a calendar refetch on EVERY commit (success
//   AND failure), per Codex 2026-05-08 stale-state invariant.

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
  const [pendingPaint, setPendingPaint] = useState<PaintSpan | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 4000)
  }

  function bumpReload() {
    setReloadCounter((n) => n + 1)
  }

  async function handleMoveTarget(target: MoveTarget) {
    // PR1 endpoint computes the new ISO from a single newStartAt
    // string; we synthesize it from MSK halfHour + ymd via the same
    // calendar helpers used elsewhere. Instead of duplicating, we
    // hand off to a small inline helper that maps (ymd, halfHour) →
    // ISO using paint-synth's mskWallToUtcIso path.
    const newStartIso = halfHourToUtcIso(target.newYmd, target.newHalfHour)
    if (!newStartIso) {
      showToast('Не удалось вычислить новое время.')
      bumpReload()
      return
    }
    try {
      const res = await fetch(`/api/admin/slots/${target.slotId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStartAt: newStartIso }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(
          `Перенос не удался: ${body.message || body.error || `HTTP ${res.status}`}`,
        )
      } else {
        showToast('Слот перенесён.')
      }
    } catch (err) {
      showToast(
        `Сеть недоступна: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      // Codex 2026-05-08 invariant: refetch on EVERY non-2xx, not just
      // success. Same logic for success — keeps timestamps and audit
      // trail consistent with what the server has.
      bumpReload()
    }
  }

  async function handlePaintConfirm({
    startsIso,
    durationMinutes,
    tariffId,
  }: {
    startsIso: ReadonlyArray<string>
    durationMinutes: number
    tariffId: string | null
  }) {
    try {
      const res = await fetch('/api/admin/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherAccountId: calendarTeacherId,
          durationMinutes,
          tariffId,
          slots: startsIso.map((s) => ({ startAt: s })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(`Ошибка: ${data?.error || `HTTP ${res.status}`}`)
      } else {
        const skippedNote =
          data.skippedConflicts?.length > 0
            ? ` (пропущено как дубль: ${data.skippedConflicts.length})`
            : ''
        showToast(`Создано ${data.created.length} слотов${skippedNote}.`)
      }
    } catch (err) {
      showToast(
        `Сеть недоступна: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setPendingPaint(null)
      bumpReload()
    }
  }

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
              {toast ? (
                <div
                  role="status"
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: 6,
                    color: '#bfdbfe',
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {toast}
                </div>
              ) : null}
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                Перетащите по пустым ячейкам — откроется диалог
                массового создания. Перетащите свободный слот по
                вертикали — он переместится. Esc отменяет жест.
              </p>
              <SlotCalendar
                key={`${calendarTeacherId}-${reloadCounter}`}
                teacherId={calendarTeacherId}
                initialFromYmd={currentMondayYmd()}
                onSlotClick={(row) => setActiveRow(row)}
                interactions={{
                  onPaintSpan: (span) => setPendingPaint(span),
                  onMoveTarget: handleMoveTarget,
                }}
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
            bumpReload()
          }}
        />
      ) : null}

      {pendingPaint ? (
        <PaintConfirmModal
          span={pendingPaint}
          tariffs={props.initialTariffs}
          onConfirm={handlePaintConfirm}
          onCancel={() => setPendingPaint(null)}
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

// Maps (ymd, halfHour 0..35 from 06:00) → UTC ISO via the same MSK
// helpers used elsewhere. Extracted inline because the dispatcher
// fires from a callback in a client component; importing the helper
// directly is fine here (no server-only deps).
function halfHourToUtcIso(ymd: string, halfHour: number): string | null {
  const totalMin = 6 * 60 + halfHour * 30
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const hhmm = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  // Inline MSK→UTC: MSK is UTC+3 year-round.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const [, y, mo, d] = match
  const yi = Number(y)
  const moi = Number(mo)
  const di = Number(d)
  const utcMs = Date.UTC(yi, moi - 1, di, h - 3, m, 0)
  if (Number.isNaN(utcMs)) return null
  return new Date(utcMs).toISOString()
}
