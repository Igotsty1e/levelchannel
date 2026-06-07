'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/primitives'

// Modal that shows the one-time bind code + deep-link to the Telegram
// bot. Mirrors the modal/sheet shell from components/teacher/pricing/
// (`pricing-modal-overlay` + `pricing-modal`) so the visual language
// stays consistent across the cabinet.
//
// Esc closes; click on overlay closes; body scroll locks while open.

export type BindCodeModalProps = {
  code: string
  expiresAt: string | null
  botUsername: string | null
  onClose: () => void
}

export function BindCodeModal({
  code,
  expiresAt,
  botUsername,
  onClose,
}: BindCodeModalProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=${code}`
    : null

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail on iframe / restricted contexts.
      // Silent fallback — the code is visible and selectable on screen.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="digest-bind-code-title"
      className="pricing-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pricing-modal pricing-sheet digest-bind-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pricing-sheet-header">
          <div>
            <h2 id="digest-bind-code-title" className="pricing-sheet-title">
              Код для Telegram-бота
            </h2>
            <p className="pricing-sheet-description">
              Откройте бота и&nbsp;отправьте код одним сообщением — или нажмите кнопку ниже,
              если Telegram установлен на&nbsp;этом устройстве.
            </p>
          </div>
          <button
            type="button"
            className="pricing-sheet-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="pricing-sheet-body">
          <div className="digest-bind-code-block">
            <span
              className="digest-bind-code-value"
              data-testid="teacher-bind-code-value"
            >
              {code}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopy}
            >
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
          </div>
          {expiresLabel ? (
            <p className="digest-bind-meta">
              Действует до&nbsp;<strong>{expiresLabel}</strong>. После — получите новый.
            </p>
          ) : null}
          <ol className="digest-bind-steps">
            <li>
              Откройте бота{' '}
              {botUsername ? (
                <strong>@{botUsername}</strong>
              ) : (
                <strong>LevelChannel</strong>
              )}{' '}
              в&nbsp;Telegram.
            </li>
            <li>
              Отправьте код {code} или нажмите «Start» — бот распознает оба формата.
            </li>
            <li>
              Вернитесь сюда — статус обновится при следующем заходе на&nbsp;страницу.
            </li>
          </ol>
          <div className="digest-bind-actions">
            {deepLink ? (
              <Button
                href={deepLink}
                variant="primary"
                size="md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть Telegram
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onClose}
            >
              Закрыть
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
