'use client'

import { useState } from 'react'

import { SlotCalendar } from '@/components/calendar/SlotCalendar'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A PR4 — teacher calendar client. Mounts <SlotCalendar /> against
// /api/slots/calendar with teacherId = own account id (server resolved
// the id and gated the route at the layout). On click, opens a small
// detail panel — read-only, no mutation surface (teachers can't cancel
// or move slots; that stays in /admin/slots).

export default function TeacherCalendarClient({
  teacherId,
  initialFromYmd,
}: {
  teacherId: string
  initialFromYmd: string
}) {
  const [activeRow, setActiveRow] = useState<CalendarRow | null>(null)

  return (
    <div>
      <SlotCalendar
        teacherId={teacherId}
        initialFromYmd={initialFromYmd}
        onSlotClick={(row) => setActiveRow(row)}
      />

      {activeRow ? (
        <SlotDetailPanel
          row={activeRow}
          onClose={() => setActiveRow(null)}
        />
      ) : null}
    </div>
  )
}

function SlotDetailPanel({
  row,
  onClose,
}: {
  row: CalendarRow
  onClose: () => void
}) {
  const slot = row.slot
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-slot-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f1f23',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 24,
          minWidth: 320,
          maxWidth: 440,
          color: '#e4e4e7',
        }}
      >
        <h2
          id="teacher-slot-title"
          style={{ fontSize: 18, marginBottom: 12 }}
        >
          Слот {row.startLabel} – {row.endLabel}
        </h2>
        <dl style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          <Row label="Дата" value={row.dayYmd} />
          <Row label="Длительность" value={`${slot.durationMinutes} мин`} />
          <Row label="Статус" value={statusLabel(slot.kind)} />
          {'learnerEmail' in slot && slot.learnerEmail ? (
            <Row label="Ученик" value={slot.learnerEmail} />
          ) : null}
          {'tariffAmountKopecks' in slot &&
          slot.tariffAmountKopecks !== null &&
          slot.tariffAmountKopecks !== undefined ? (
            <Row
              label="Тариф"
              value={`${(slot.tariffAmountKopecks / 100).toLocaleString('ru-RU')} ₽`}
            />
          ) : null}
        </dl>
        <p
          style={{
            color: '#71717a',
            fontSize: 12,
            marginTop: 16,
            lineHeight: 1.5,
          }}
        >
          Для отмены или переноса свяжитесь с оператором.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#e4e4e7',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ minWidth: 100, color: '#71717a' }}>{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Свободен'
    case 'booked-self':
      return 'Забронирован вами'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронирован'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедший'
  }
}
