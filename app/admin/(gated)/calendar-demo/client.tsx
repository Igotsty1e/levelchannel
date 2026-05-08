'use client'

import { useState } from 'react'

import { SlotCalendar } from '@/components/calendar/SlotCalendar'

export default function CalendarDemoClient({
  teachers,
  initialFromYmd,
}: {
  teachers: Array<{ id: string; email: string }>
  initialFromYmd: string
}) {
  const [teacherId, setTeacherId] = useState<string>(teachers[0]?.id ?? '')

  if (teachers.length === 0) {
    return (
      <p style={{ color: '#fbbf24', fontSize: 14 }}>
        Нет учителей в системе — создайте хотя бы один аккаунт с ролью teacher через /admin/accounts.
      </p>
    )
  }

  return (
    <div>
      <label
        style={{
          display: 'block',
          marginBottom: 16,
          fontSize: 13,
          color: '#9ca3af',
        }}
      >
        Учитель:{' '}
        <select
          value={teacherId}
          onChange={(e) => setTeacherId(e.target.value)}
          style={{
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: '#e4e4e7',
            fontSize: 13,
            marginLeft: 8,
          }}
        >
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.email}
            </option>
          ))}
        </select>
      </label>
      <SlotCalendar
        key={teacherId}
        teacherId={teacherId}
        initialFromYmd={initialFromYmd}
        onSlotClick={(row) => {
          // Demo: just log. PR3 will show a proper modal.
          // eslint-disable-next-line no-console
          console.log('Clicked slot', row)
        }}
      />
    </div>
  )
}
