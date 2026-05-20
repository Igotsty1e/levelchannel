'use client'

// BCS-DEF-4-TG (2026-05-20) — cabinet Telegram binding UI for learners.
// Replaces the BCS-DEF-4 LearnerTelegramPlaceholder.
//
// Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.7.

import { useState, useTransition } from 'react'

import {
  requestLearnerTelegramBindCode,
  unbindLearnerTelegram,
} from '@/lib/learner-telegram-bind/actions'

type Props = {
  initialBound: boolean
  initialChatId: string | null
  masterSwitchOn: boolean
}

export function LearnerTelegramBinding({
  initialBound,
  initialChatId: _initialChatId,
  masterSwitchOn,
}: Props) {
  const [bound, setBound] = useState(initialBound)
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [botUsername, setBotUsername] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const onIssue = () => {
    setError(null)
    startTransition(async () => {
      const result = await requestLearnerTelegramBindCode()
      if (result.ok) {
        setCode(result.code)
        setExpiresAt(result.expiresAt)
        setBotUsername(result.botUsername)
      } else {
        if (result.error === 'rate_limited') {
          setError(
            `Слишком частые запросы. Попробуйте через ${Math.ceil(
              result.retryAfterSeconds / 60,
            )} мин.`,
          )
        } else if (result.error === 'channel_disabled') {
          setError('Telegram-канал временно отключён.')
        } else if (result.error === 'account_unavailable') {
          setError('Аккаунт недоступен.')
        }
      }
    })
  }

  const onUnbind = () => {
    if (!confirm('Отписаться от напоминаний в Telegram?')) return
    setError(null)
    startTransition(async () => {
      const result = await unbindLearnerTelegram()
      if (result.ok) {
        setBound(false)
        setCode(null)
        setExpiresAt(null)
      } else if (result.error === 'rate_limited') {
        setError(
          `Слишком частые запросы. Попробуйте через ${Math.ceil(
            result.retryAfterSeconds / 60,
          )} мин.`,
        )
      } else if (result.error === 'not_bound') {
        setBound(false)
      }
    })
  }

  if (!masterSwitchOn) {
    return (
      <section
        data-testid="learner-telegram-binding"
        style={{
          marginTop: 24,
          padding: '16px 20px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Напоминания в&nbsp;Telegram
        </h2>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Telegram-канал временно недоступен. Напоминания приходят на&nbsp;e-mail.
        </p>
      </section>
    )
  }

  return (
    <section
      data-testid="learner-telegram-binding"
      style={{
        marginTop: 24,
        padding: '16px 20px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        Напоминания в&nbsp;Telegram
      </h2>

      {bound ? (
        <>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px 0' }}>
            Telegram подключён. Напоминания будут приходить в&nbsp;ваш чат с&nbsp;ботом.
          </p>
          <button
            type="button"
            onClick={onUnbind}
            disabled={pending}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: pending ? 'wait' : 'pointer',
              fontSize: 14,
            }}
          >
            {pending ? 'Отписываем…' : 'Отвязать Telegram'}
          </button>
        </>
      ) : code ? (
        <>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px 0' }}>
            Ваш одноразовый код:
          </p>
          <p
            data-testid="bind-code-value"
            style={{
              fontFamily: 'monospace',
              fontSize: 24,
              letterSpacing: '0.15em',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              display: 'inline-block',
              margin: '0 0 12px 0',
            }}
          >
            {code}
          </p>
          {expiresAt ? (
            <p style={{ color: 'var(--secondary)', fontSize: 12, margin: '0 0 12px 0' }}>
              Действителен до&nbsp;{new Date(expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.
            </p>
          ) : null}
          {botUsername ? (
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 12px 0' }}>
              Откройте бота{' '}
              <a
                href={`https://t.me/${botUsername}?start=${code}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline' }}
              >
                @{botUsername}
              </a>{' '}
              и&nbsp;нажмите «Start» (или отправьте <code style={{ fontFamily: 'monospace' }}>/start {code}</code>).
            </p>
          ) : (
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 12px 0' }}>
              Откройте бота LevelChannel в&nbsp;Telegram и&nbsp;отправьте{' '}
              <code style={{ fontFamily: 'monospace' }}>/start {code}</code>.
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px 0' }}>
            Получите одноразовый код и&nbsp;отправьте его боту LevelChannel в&nbsp;Telegram.
          </p>
          <button
            type="button"
            onClick={onIssue}
            disabled={pending}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--bg)',
              cursor: pending ? 'wait' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {pending ? 'Получаем код…' : 'Получить код'}
          </button>
        </>
      )}

      {error ? (
        <p
          role="alert"
          style={{ color: '#ff8a8a', fontSize: 13, marginTop: 12, marginBottom: 0 }}
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
