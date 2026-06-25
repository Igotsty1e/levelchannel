'use client'

import { useState } from 'react'

import { Button, Modal } from '@/components/ui/primitives'

// 2026-06-25 Epic 5 wave 3: migrated на Modal primitive.
// Раньше использовал pricing-modal CSS classes — теперь unified shell.

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
    <Modal open={true} onClose={onClose} title="Код для Telegram-бота" size="md">
      <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--secondary)', margin: 0, marginBottom: 16 }}>
        Откройте бота и&nbsp;отправьте код одним сообщением — или нажмите кнопку ниже,
        если Telegram установлен на&nbsp;этом устройстве.
      </p>
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
      <Modal.Footer>
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
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          Закрыть
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
