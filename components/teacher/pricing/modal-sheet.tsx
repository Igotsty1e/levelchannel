'use client'

import { useEffect, type ReactNode } from 'react'

// Shared modal/sheet shell for /teacher/tariffs and /teacher/packages
// create flows. On desktop it renders as a centred modal (max-w 480px);
// on mobile (≤480px) it covers the viewport bottom-sheet style — full
// width, anchored to the bottom edge for thumb-zone reach. Animation is
// kept implicit (rendered/unmounted by parent).
//
// Esc closes; click on overlay closes; body scroll locked while open.

export type ModalSheetProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Optional descriptor that goes right under the title. */
  description?: ReactNode
  /** When true, closing via Esc / overlay is disabled (e.g. while busy). */
  locked?: boolean
}

export function ModalSheet({
  title,
  description,
  onClose,
  children,
  locked = false,
}: ModalSheetProps) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [locked, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-sheet-title"
      className="pricing-modal-overlay"
      onClick={locked ? undefined : onClose}
    >
      <div
        className="pricing-modal pricing-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pricing-sheet-header">
          <div>
            <h2 id="pricing-sheet-title" className="pricing-sheet-title">
              {title}
            </h2>
            {description ? (
              <p className="pricing-sheet-description">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="pricing-sheet-close"
            onClick={onClose}
            disabled={locked}
            aria-label="Закрыть"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="pricing-sheet-body">{children}</div>
      </div>
    </div>
  )
}
