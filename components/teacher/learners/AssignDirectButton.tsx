'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  AssignDirectModal,
  type AssignTariffOption,
} from '@/components/calendar/AssignDirectModal'

// Точка входа «Назначить занятие» из профиля ученика
// /teacher/learners/[id] (2026-06-12). Переиспользует
// AssignDirectModal с preset-ученика и mode='single'. Серия
// назначается из /teacher/calendar — здесь только разовое.
export function AssignDirectButton({
  learner,
  tariffs,
  teacherTz,
}: {
  learner: { id: string; displayName: string }
  tariffs: ReadonlyArray<AssignTariffOption>
  teacherTz: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const disabled = tariffs.length === 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'Создайте хотя бы один тариф' : undefined}
        style={{
          minHeight: 44,
          padding: '12px 18px',
          background: disabled ? 'var(--surface-2)' : 'var(--accent)',
          color: disabled ? 'var(--text-secondary)' : 'var(--text-on-accent)',
          border: '1px solid',
          borderColor: disabled ? 'var(--border)' : 'var(--accent)',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Назначить занятие
      </button>
      <AssignDirectModal
        open={open}
        onClose={() => setOpen(false)}
        tariffs={tariffs}
        teacherTz={teacherTz}
        presetLearner={learner}
        mode="single"
        onCreated={() => {
          router.refresh()
        }}
      />
    </>
  )
}
