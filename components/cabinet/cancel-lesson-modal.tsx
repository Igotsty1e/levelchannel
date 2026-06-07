'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/primitives'

// Learner-side cancel-confirm modal (2026-06-07).
//
// Owner ask: ученик нажимал «Отменить» и занятие исчезало без
// предупреждения и без причины — это лишает учителя контекста и
// позволяет случайные отмены. Этот модал:
//
//   - подтверждает, что отмена занятия — явный интент (нельзя случайно
//     кликнуть Enter и потерять урок),
//   - требует причину минимум 10 символов (Backend принимает любую
//     строку — валидация UI-side),
//   - показывает занятие, которое будет отменено, и напоминает о
//     политике 24 ч (cancelWindowHours приходит пропом).
//
// Чисто frontend — backend `/api/slots/[id]/cancel` уже принимает
// `{ reason }`, ничего не нужно менять серверно.

const MIN_REASON_LENGTH = 10

export type CancelLessonModalProps = {
  /** Title prefix, e.g. «вт, 09 июн, 10:00 · 60 мин». */
  slotLabel: string
  cancelWindowHours: number
  /** Async — модал сам показывает кнопку «Отменяем…». */
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

export function CancelLessonModal({
  slotLabel,
  cancelWindowHours,
  onConfirm,
  onClose,
}: CancelLessonModalProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Автофокус на поле причины — главное действие в модале.
    textareaRef.current?.focus()
  }, [])

  const trimmedReason = reason.trim()
  const reasonTooShort = trimmedReason.length < MIN_REASON_LENGTH
  const canSubmit = !busy && !reasonTooShort

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    try {
      await onConfirm(trimmedReason)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отменить — попробуйте ещё раз.')
      setBusy(false)
    }
    // На success родитель закроет модал сам через onClose в then-ветке.
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-lesson-title"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          padding: 24,
          minWidth: 320,
          maxWidth: 480,
          width: '100%',
        }}
      >
        <h2
          id="cancel-lesson-title"
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            marginBottom: 8,
          }}
        >
          Отменить занятие?
        </h2>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
            marginBottom: 16,
          }}
        >
          {slotLabel}
        </p>

        <div
          style={{
            background: 'var(--accent-bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          Отмена позже чем за {cancelWindowHours} ч до начала через систему
          невозможна — нужно будет договариваться с учителем напрямую.
          Учитель увидит вашу причину и сможет предложить альтернативное время.
        </div>

        <label
          htmlFor="cancel-reason"
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--secondary)',
            marginBottom: 6,
          }}
        >
          Причина отмены
        </label>
        <textarea
          id="cancel-reason"
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Например: заболел, перенесли встречу, нужно перенести…"
          disabled={busy}
          style={{
            width: '100%',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            color: 'var(--text)',
            fontSize: 14,
            fontFamily: 'inherit',
            lineHeight: 1.5,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--secondary)',
            marginTop: 6,
            marginBottom: 16,
          }}
        >
          <span>
            {reasonTooShort
              ? `Минимум ${MIN_REASON_LENGTH} символов — учителю важно понять причину.`
              : 'Учитель увидит этот текст.'}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {trimmedReason.length}/500
          </span>
        </div>

        {err ? (
          <p
            style={{
              color: 'var(--danger)',
              fontSize: 13,
              margin: 0,
              marginBottom: 12,
            }}
          >
            {err}
          </p>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            type="button"
          >
            Не отменять
          </Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            disabled={!canSubmit}
            type="button"
          >
            {busy ? 'Отменяем…' : 'Отменить занятие'}
          </Button>
        </div>
      </div>
    </div>
  )
}
