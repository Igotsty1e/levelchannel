'use client'

// teacher-lessons-edit-status epic (2026-06-24) — confirm dialog для
// kebab-меню изменения статуса.
//
// Контракт:
//   - kind='lesson' → показывает billing warning (по paymentStatus) +
//     чекбокс «Уведомить ученика» (default OFF, optional).
//   - kind='deal' → ни warning'а, ни чекбокса.
//   - Подтверждение → onConfirm(notifyLearner) → родитель fires API call.

import { Button, Modal } from '@/components/ui/primitives'

import type { DealTargetStatus, LessonTargetStatus } from './status-change-menu'

type PaymentStatus = 'paid_package' | 'paid_direct' | 'unpaid' | null

type LessonProps = {
  kind: 'lesson'
  subject: string
  startAtFormatted: string
  fromLabel: string
  toLabel: string
  toStatus: LessonTargetStatus
  paymentStatus: PaymentStatus
  busy: boolean
  notifyLearner: boolean
  onNotifyChange: (v: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

type DealProps = {
  kind: 'deal'
  subject: string
  startAtFormatted: string
  fromLabel: string
  toLabel: string
  toStatus: DealTargetStatus
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

type Props = LessonProps | DealProps

function billingWarning(props: LessonProps): string | null {
  const { toStatus, paymentStatus } = props
  // Только transitions, которые меняют paid-state, требуют warning.
  // Простой эвристика: если урок был оплачен (paymentStatus !== unpaid)
  // и идёт в booked/no_show_teacher (paid-state потенциально меняется).
  if (paymentStatus === 'paid_package') {
    if (toStatus === 'booked' || toStatus === 'no_show_teacher') {
      return 'Пакет ученика восстановится — занятие вернётся в задолженность.'
    }
  }
  if (paymentStatus === 'paid_direct') {
    if (toStatus === 'booked' || toStatus === 'no_show_teacher') {
      return 'Прямая оплата останется без изменений; статус обновится. Возврат — отдельно.'
    }
  }
  return null
}

export function StatusChangeConfirmModal(props: Props) {
  const warning = props.kind === 'lesson' ? billingWarning(props) : null

  return (
    <Modal
      open={true}
      onClose={props.onCancel}
      busy={props.busy}
      title={props.kind === 'lesson' ? 'Изменить статус занятия?' : 'Изменить статус дела?'}
    >
      <div style={{ fontSize: 14, color: 'var(--secondary)', marginBottom: 12 }}>
        {props.subject} · {props.startAtFormatted}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 16px',
          fontSize: 14,
          marginBottom: 16,
        }}
      >
        <span style={{ color: 'var(--secondary)' }}>Было:</span>
        <span>{props.fromLabel}</span>
        <span style={{ color: 'var(--secondary)' }}>Станет:</span>
        <span style={{ fontWeight: 500 }}>{props.toLabel}</span>
      </div>

      {warning ? (
        <div
          role="note"
          style={{
            padding: '10px 12px',
            background: 'rgba(255, 200, 0, 0.08)',
            border: '1px solid rgba(255, 200, 0, 0.3)',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            color: 'var(--text)',
          }}
        >
          ⚠ {warning}
        </div>
      ) : null}

      {props.kind === 'lesson' ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            marginBottom: 4,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={props.notifyLearner}
            onChange={(e) => props.onNotifyChange(e.target.checked)}
            disabled={props.busy}
          />
          Уведомить ученика об изменении
        </label>
      ) : null}

      <Modal.Footer>
        <Button variant="ghost" size="md" onClick={props.onCancel} disabled={props.busy}>
          Отмена
        </Button>
        <Button variant="primary" size="md" onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? 'Сохраняем…' : 'Изменить статус'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
