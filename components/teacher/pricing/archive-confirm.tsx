'use client'

import { Button, Modal } from '@/components/ui/primitives'

// Confirmation modal for archive actions on /teacher/tariffs and
// /teacher/packages. One component, two callers: the copy is supplied
// by the caller так не хардкодим «цена» vs «пакет» внутри.
//
// 2026-06-24 Epic 5 sweep wave 2 — migrated на Modal primitive.

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
  return (
    <Modal open={true} onClose={onCancel} busy={busy} title={title} size="sm">
      <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0, marginBottom: 16 }}>
        {body}
      </p>
      {errorMessage ? (
        <div
          role="alert"
          style={{
            color: 'var(--danger)',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {errorMessage}
        </div>
      ) : null}
      <Modal.Footer>
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
      </Modal.Footer>
    </Modal>
  )
}
