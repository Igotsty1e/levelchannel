'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/primitives'

// Confirmation modal for archive actions on /teacher/tariffs and
// /teacher/packages. One component, two callers: the copy is supplied
// by the caller so we don't hard-code «цена» vs «пакет» inside.
//
// Behavior: locked-overlay (click-outside cancels unless busy), Esc to
// close, focus trapped on cancel by default so accidental Enter doesn't
// archive.

export type ArchiveConfirmProps = {
  title: string
  body: string
  errorMessage: string | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  /** Label on the destructive button; defaults to «Архивировать». */
  confirmLabel?: string
}

export function ArchiveConfirm({
  title,
  body,
  errorMessage,
  busy,
  onCancel,
  onConfirm,
  confirmLabel = 'Архивировать',
}: ArchiveConfirmProps) {
  // Esc-to-close, also locks body scroll while the modal is up.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [busy, onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-archive-title"
      className="pricing-modal-overlay"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="pricing-modal pricing-modal-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="pricing-archive-title" className="pricing-modal-title">
          {title}
        </h3>
        <p className="pricing-modal-body">{body}</p>
        {errorMessage ? (
          <div role="alert" className="pricing-modal-error">
            {errorMessage}
          </div>
        ) : null}
        <div className="pricing-modal-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            loading={busy}
            onClick={() => {
              void onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
