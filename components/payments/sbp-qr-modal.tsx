'use client'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { usePaymentStatusPoll } from '@/components/payments/use-payment-status-poll'

// SBP-PAY (2026-05-19) — QR modal that renders the CloudPayments-
// hosted QR PNG, threads the receipt-token through the status-poll
// hook, and transitions on paid / failed / timeout.
//
// Contract:
//   - `qrUrl` — CloudPayments-hosted PNG URL (NSPK format). Preferred
//     over base64 for cache-friendliness. `image` (base64) is offered
//     as a fallback when qrUrl is missing.
//   - `receiptToken` — plain token from the create-qr response; the
//     usePaymentStatusPoll hook sends it as `X-Receipt-Token` on
//     every poll tick.
//   - `isGuest` — derived from server-side `accountIdAttached` boolean
//     (§0b WARN#3 closure — pinned at order-create time, not from
//     stale client auth state). Toggles the deep-link-return warning
//     copy for guests (§1.4 closure).
//   - `onClose` / `onPaid` / `onFailed` / `onTimeout` — caller owns
//     the state transitions (redirect to /thank-you on paid, error
//     UI on failed, etc.).

export type SbpQrModalProps = {
  invoiceId: string
  qrUrl: string
  image?: string | null
  receiptToken: string
  isGuest: boolean
  onClose: () => void
  onPaid: () => void
  onFailed: (reason?: string) => void
  onTimeout: () => void
}

export function SbpQrModal({
  invoiceId,
  qrUrl,
  image,
  receiptToken,
  isGuest,
  onClose,
  onPaid,
  onFailed,
  onTimeout,
}: SbpQrModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'waiting' | 'paid' | 'failed' | 'timeout'>(
    'waiting',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePaid = useCallback(() => {
    setPhase('paid')
    onPaid()
  }, [onPaid])

  const handleFailed = useCallback(
    (reason?: string) => {
      setPhase('failed')
      setErrorMessage(
        reason && reason !== 'cancelled' && reason !== 'receipt_token_mismatch'
          ? reason
          : 'Платёж не прошёл. Попробуйте ещё раз.',
      )
      onFailed(reason)
    },
    [onFailed],
  )

  const handleTimeout = useCallback(() => {
    setPhase('timeout')
    onTimeout()
  }, [onTimeout])

  usePaymentStatusPoll({
    invoiceId,
    receiptToken,
    onPaid: handlePaid,
    onFailed: handleFailed,
    onTimeout: handleTimeout,
  })

  // A11y — focus the close button on mount + handle ESC to close.
  useEffect(() => {
    closeButtonRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Render the QR image — prefer the qrUrl (CDN cacheable); fall back
  // to base64 image when qrUrl is missing (defence-in-depth, should
  // not happen for a 'success' result from createSbpQr).
  const qrSrc = qrUrl || (image ? `data:image/png;base64,${image}` : '')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sbp-qr-modal-heading"
      ref={containerRef}
      style={overlayStyle}
      onClick={(event) => {
        // Click outside the inner card closes the modal. Click inside
        // the card is a no-op (event.target is the card itself or a
        // descendant; we check the ref identity to avoid bubbling).
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div style={cardStyle}>
        <header style={headerStyle}>
          <h2 id="sbp-qr-modal-heading" style={headingStyle}>
            Оплата через СБП
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Закрыть окно оплаты СБП"
            style={closeButtonStyle}
          >
            ×
          </button>
        </header>

        {phase === 'waiting' ? (
          <>
            <p style={bodyTextStyle}>
              Откройте приложение вашего банка → раздел «СБП» или «Сканировать
              QR» → отсканируйте этот код.
            </p>

            {qrSrc ? (
              <div style={qrWrapperStyle}>
                <img
                  src={qrSrc}
                  alt="QR-код для оплаты через СБП"
                  style={qrImageStyle}
                />
              </div>
            ) : (
              <p style={errorTextStyle}>
                Не удалось загрузить QR-код. Попробуйте ещё раз.
              </p>
            )}

            {qrUrl ? (
              <a
                href={qrUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={deepLinkButtonStyle}
              >
                Открыть в приложении банка
              </a>
            ) : null}

            <p style={spinnerCaptionStyle}>
              <span style={spinnerStyle} aria-hidden="true" />
              Ожидаем подтверждение оплаты…
            </p>

            {isGuest ? (
              <p style={guestHintStyle}>
                Не закрывайте эту страницу до оплаты — после возврата из
                приложения банка вы увидите подтверждение здесь.
              </p>
            ) : null}
          </>
        ) : null}

        {phase === 'paid' ? (
          <p style={paidTextStyle}>
            Оплата прошла. Перенаправляем на страницу подтверждения…
          </p>
        ) : null}

        {phase === 'failed' ? (
          <>
            <p style={errorTextStyle}>{errorMessage}</p>
            <button
              type="button"
              onClick={onClose}
              style={primaryButtonStyle}
            >
              Закрыть
            </button>
          </>
        ) : null}

        {phase === 'timeout' ? (
          <>
            <p style={errorTextStyle}>
              Истёк лимит времени ожидания платежа. Если вы оплатили, деньги
              придут — мы пришлём чек на e-mail. Не оплачивайте ещё раз.
            </p>
            <button
              type="button"
              onClick={onClose}
              style={primaryButtonStyle}
            >
              Закрыть
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  zIndex: 1000,
}

const cardStyle: CSSProperties = {
  background: '#0F0F11',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 20,
  padding: 24,
  maxWidth: 380,
  width: '100%',
  color: '#fff',
  display: 'grid',
  gap: 16,
  boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const headingStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  margin: 0,
}

const closeButtonStyle: CSSProperties = {
  background: 'transparent',
  color: '#A1A1AA',
  border: 'none',
  fontSize: 28,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 4,
}

const bodyTextStyle: CSSProperties = {
  color: '#D4D4D8',
  fontSize: 14,
  lineHeight: 1.55,
  margin: 0,
}

const qrWrapperStyle: CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  padding: 12,
  display: 'flex',
  justifyContent: 'center',
}

const qrImageStyle: CSSProperties = {
  width: '100%',
  maxWidth: 260,
  height: 'auto',
  display: 'block',
}

const deepLinkButtonStyle: CSSProperties = {
  display: 'block',
  textAlign: 'center',
  padding: '12px 16px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 600,
}

const spinnerCaptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: '#A1A1AA',
  fontSize: 13,
  margin: 0,
}

const spinnerStyle: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '2px solid rgba(232,168,144,0.3)',
  borderTopColor: '#E8A890',
  animation: 'spin 0.9s linear infinite',
  display: 'inline-block',
}

const guestHintStyle: CSSProperties = {
  color: '#FDE68A',
  fontSize: 12,
  lineHeight: 1.55,
  background: 'rgba(250,204,21,0.08)',
  border: '1px solid rgba(250,204,21,0.18)',
  borderRadius: 12,
  padding: '10px 12px',
  margin: 0,
}

const paidTextStyle: CSSProperties = {
  color: '#86EFAC',
  fontSize: 14,
  margin: 0,
}

const errorTextStyle: CSSProperties = {
  color: '#FCA5A5',
  fontSize: 13,
  lineHeight: 1.55,
  margin: 0,
}

const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #C87878 0%, #E8A890 100%)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}
