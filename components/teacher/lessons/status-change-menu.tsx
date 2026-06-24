'use client'

// teacher-lessons-edit-status epic (2026-06-24) — kebab popover menu
// для изменения статуса прошедшего урока или дела.
//
// Контракт:
//   - kind='lesson' → показывает 4 цели (completed/no_show_learner/
//     no_show_teacher/booked) минус current и cancelled-out.
//     Если canEdit.edit=false для transitions, требующих DELETE
//     completion, показывает disabled позицию с tooltip (immutable /
//     settled / accrued reason).
//   - kind='deal' → показывает 3 цели (personal_event/completed/cancelled)
//     минус current. Никаких gates.
//   - На выбор кnopки → onSelect(target). Родитель открывает
//     ConfirmModal.

import { useEffect, useRef, useState } from 'react'

export type LessonTargetStatus = 'completed' | 'no_show_learner' | 'no_show_teacher' | 'booked'
export type DealTargetStatus = 'personal_event' | 'completed' | 'cancelled'
type Target = LessonTargetStatus | DealTargetStatus

type CanEditReason = 'immutable' | 'settled' | 'accrued' | null

type LessonProps = {
  kind: 'lesson'
  currentStatus: LessonTargetStatus | 'cancelled'
  canEdit: { edit: boolean; reason: CanEditReason }
  onSelect: (target: LessonTargetStatus) => void
}

type DealProps = {
  kind: 'deal'
  currentStatus: DealTargetStatus
  onSelect: (target: DealTargetStatus) => void
}

type Props = LessonProps | DealProps

const LESSON_LABELS: Record<LessonTargetStatus, string> = {
  completed: 'Проведено',
  no_show_learner: 'Не пришёл',
  no_show_teacher: 'Учитель не пришёл',
  booked: 'Не оплачено (вернуть)',
}

const DEAL_LABELS: Record<DealTargetStatus, string> = {
  personal_event: 'Активно (вернуть)',
  completed: 'Выполнено',
  cancelled: 'Отменено',
}

function reasonLabel(reason: CanEditReason): string {
  switch (reason) {
    case 'immutable':
      return 'Прошло 48 часов — статус нельзя изменить.'
    case 'settled':
      return 'Урок уже учтён в платежах — статус нельзя изменить.'
    case 'accrued':
      return 'По уроку уже начислена выплата — статус нельзя изменить.'
    default:
      return ''
  }
}

export function StatusChangeMenu(props: Props) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const targets: Target[] =
    props.kind === 'lesson'
      ? (['completed', 'no_show_learner', 'no_show_teacher', 'booked'] as LessonTargetStatus[]).filter(
          (t) => t !== props.currentStatus,
        )
      : (['personal_event', 'completed', 'cancelled'] as DealTargetStatus[]).filter(
          (t) => t !== props.currentStatus,
        )

  function handleSelect(target: Target) {
    setOpen(false)
    if (props.kind === 'lesson') {
      props.onSelect(target as LessonTargetStatus)
    } else {
      props.onSelect(target as DealTargetStatus)
    }
  }

  // canEdit affects only transitions that delete the completion row
  // (completed/no_show_learner → booked/no_show_teacher).
  function isDisabled(target: Target): boolean {
    if (props.kind !== 'lesson') return false
    if (props.canEdit.edit) return false
    const current = props.currentStatus
    const needsDelete =
      (current === 'completed' || current === 'no_show_learner') &&
      (target === 'booked' || target === 'no_show_teacher')
    return needsDelete
  }

  const tooltipReason = props.kind === 'lesson' ? props.canEdit.reason : null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Изменить статус"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--secondary)',
          cursor: 'pointer',
          padding: '4px 8px',
          fontSize: 16,
          lineHeight: 1,
          borderRadius: 4,
        }}
      >
        ⋯
      </button>
      {open ? (
        <div
          ref={popRef}
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 100,
            minWidth: 220,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            padding: 4,
            marginTop: 4,
          }}
        >
          {targets.map((target) => {
            const disabled = isDisabled(target)
            const label =
              props.kind === 'lesson'
                ? LESSON_LABELS[target as LessonTargetStatus]
                : DEAL_LABELS[target as DealTargetStatus]
            return (
              <button
                key={target}
                type="button"
                role="menuitem"
                onClick={() => !disabled && handleSelect(target)}
                disabled={disabled}
                title={disabled ? reasonLabel(tooltipReason) : undefined}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: disabled ? 'var(--secondary)' : 'var(--text)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  padding: '8px 12px',
                  borderRadius: 4,
                  fontSize: 14,
                  opacity: disabled ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!disabled) e.currentTarget.style.background = 'var(--surface-2, rgba(255,255,255,0.05))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                Изменить на «{label}»
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
