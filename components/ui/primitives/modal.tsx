'use client'

// Modal primitive — Epic 5 (2026-06-24).
// Plan: docs/plans/teacher-payments-design-MASTER-ROADMAP-2026-06-22.md Epic 5.
//
// Унифицирует 25 ad-hoc modal patterns в cabinet/teacher/admin/calendar.
// Контракт:
//   - role="dialog" aria-modal="true" aria-labelledby={titleId}
//   - ESC закрывает (если не busy)
//   - backdrop click закрывает (если не busy)
//   - Card centered, max-width per size prop
//   - Body scroll lock пока open
//   - Focus автоматически на первый focusable element после mount
//
// Использование:
//   <Modal open={open} onClose={...} title="Заголовок" size="md" busy={busy}>
//     <p>Content</p>
//     <Modal.Footer>
//       <Button onClick={onClose}>Отмена</Button>
//       <Button variant="primary" onClick={submit}>OK</Button>
//     </Modal.Footer>
//   </Modal>

import { useEffect, useId, useRef, type ReactNode } from 'react'

export type ModalSize = 'sm' | 'md' | 'lg'

const SIZE_MAX_WIDTH: Record<ModalSize, number> = {
  sm: 360,
  md: 480,
  lg: 640,
}

export type ModalProps = {
  /** Открыть или скрыть модалку. */
  open: boolean
  /** Закрывает модалку (ESC + backdrop click). */
  onClose: () => void
  /** Заголовок, рендерится в <h2>; задаёт aria-labelledby. */
  title: string
  /** При true backdrop click + ESC disabled. */
  busy?: boolean
  /** Ширина модалки. Default 'md' (480px). */
  size?: ModalSize
  /** Дополнительный label для технических сurfaces. Если задан — заменяет
   * aria-labelledby на aria-label. */
  ariaLabelOverride?: string
  /** Содержимое body. Footer кладите через <Modal.Footer>. */
  children: ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  busy = false,
  size = 'md',
  ariaLabelOverride,
  children,
}: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  // ESC handler — registers only when open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  // Body scroll lock пока open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Auto-focus первый focusable element после mount.
  useEffect(() => {
    if (!open) return
    const card = cardRef.current
    if (!card) return
    const focusable = card.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()
  }, [open])

  if (!open) return null

  const a11yProps = ariaLabelOverride
    ? { 'aria-label': ariaLabelOverride }
    : { 'aria-labelledby': titleId }

  return (
    <div
      role="dialog"
      aria-modal="true"
      {...a11yProps}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={cardRef}
        className="card"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxWidth: SIZE_MAX_WIDTH[size],
          width: '100%',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
        }}
      >
        <h2
          id={titleId}
          style={{
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            marginBottom: 16,
          }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/**
 * Footer slot — кладёт action buttons справа с правильным spacing.
 * Usage:
 *   <Modal.Footer>
 *     <Button onClick={onClose}>Отмена</Button>
 *     <Button variant="primary" onClick={submit}>OK</Button>
 *   </Modal.Footer>
 */
Modal.Footer = function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 20,
        flexWrap: 'wrap',
      }}
    >
      {children}
    </div>
  )
}
