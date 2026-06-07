'use client'

import { useState, useTransition } from 'react'

import { Button, Pill } from '@/components/ui/primitives'
import {
  requestTeacherTelegramBindCode,
  unbindTeacherTelegram,
} from '@/lib/teacher-telegram-bind/actions'

import { BindCodeModal } from './bind-code-modal'

// /teacher/settings/digest — Telegram channel card.
//
// State machine (visible to the teacher):
//   - не привязан → CTA «Привязать»; нажатие открывает модалку с
//                   одноразовым кодом + deep-link на бота
//   - привязан    → пилл «Привязан», CTA «Отвязать» (danger, sm)
//
// `masterSwitchOn=false` означает: оператор временно выключил
// Telegram-канал на уровне платформы. Показываем спокойную плашку
// «временно недоступен» без CTA — нечего нажимать.
//
// Карточка собирается на одном уровне DOM, чтобы при переходе между
// state'ами не дёргалась высота сетки. Все мутации идут через server
// actions, которые уже знают rate-limit + master-switch + role gate.

export type TelegramDigestCardProps = {
  initialBound: boolean
  masterSwitchOn: boolean
}

type BindCodePayload = {
  code: string
  expiresAt: string | null
  botUsername: string | null
}

export function TelegramDigestCard({
  initialBound,
  masterSwitchOn,
}: TelegramDigestCardProps) {
  const [bound, setBound] = useState(initialBound)
  const [bindCode, setBindCode] = useState<BindCodePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const onIssue = () => {
    setError(null)
    startTransition(async () => {
      const result = await requestTeacherTelegramBindCode()
      if (result.ok) {
        setBindCode({
          code: result.code,
          expiresAt: result.expiresAt,
          botUsername: result.botUsername,
        })
      } else if (result.error === 'rate_limited') {
        setError(
          `Слишком частые запросы. Попробуйте через ${Math.ceil(
            result.retryAfterSeconds / 60,
          )} мин.`,
        )
      } else if (result.error === 'channel_disabled') {
        setError('Telegram временно недоступен.')
      } else if (result.error === 'account_unavailable') {
        setError('Аккаунт недоступен.')
      } else if (result.error === 'not_teacher') {
        setError('Доступно только учителям.')
      }
    })
  }

  const onUnbind = () => {
    if (!confirm('Отвязать Telegram от дайджеста?')) return
    setError(null)
    startTransition(async () => {
      const result = await unbindTeacherTelegram()
      if (result.ok) {
        setBound(false)
        setBindCode(null)
      } else if (result.error === 'rate_limited') {
        setError(
          `Слишком частые запросы. Попробуйте через ${Math.ceil(
            result.retryAfterSeconds / 60,
          )} мин.`,
        )
      } else if (result.error === 'not_bound') {
        setBound(false)
      } else if (result.error === 'not_teacher') {
        setError('Доступно только учителям.')
      }
    })
  }

  if (!masterSwitchOn) {
    return (
      <article
        className="digest-card digest-card-soon"
        data-testid="teacher-telegram-binding"
        aria-disabled="true"
      >
        <header className="digest-card-head">
          <div className="digest-card-head-text">
            <h2 className="digest-card-title">Telegram</h2>
            <p className="digest-card-sub">Дайджест в&nbsp;чат с&nbsp;ботом</p>
          </div>
          <Pill tone="default">Временно недоступен</Pill>
        </header>
        <p className="digest-card-body">
          Канал временно отключён на&nbsp;платформе. Дайджест продолжает приходить на&nbsp;e-mail.
        </p>
      </article>
    )
  }

  return (
    <>
      <article
        className={`digest-card${bound ? ' digest-card-bound' : ''}`}
        data-testid="teacher-telegram-binding"
      >
        <header className="digest-card-head">
          <div className="digest-card-head-text">
            <h2 className="digest-card-title">Telegram</h2>
            <p className="digest-card-sub">Дайджест в&nbsp;чат с&nbsp;ботом</p>
          </div>
          {bound ? (
            <Pill tone="success">Привязан</Pill>
          ) : (
            <Pill tone="default">Не&nbsp;привязан</Pill>
          )}
        </header>
        <p className="digest-card-body">
          {bound
            ? 'Утренний дайджест приходит в ваш чат с ботом LevelChannel.'
            : 'Получите одноразовый код и отправьте его боту — после этого дайджест начнёт приходить в Telegram.'}
        </p>
        <div className="digest-card-actions">
          {bound ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={onUnbind}
              disabled={pending}
              loading={pending}
            >
              Отвязать
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onIssue}
              disabled={pending}
              loading={pending}
            >
              Привязать
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="digest-card-error">
            {error}
          </p>
        ) : null}
      </article>

      {bindCode ? (
        <BindCodeModal
          code={bindCode.code}
          expiresAt={bindCode.expiresAt}
          botUsername={bindCode.botUsername}
          onClose={() => setBindCode(null)}
        />
      ) : null}
    </>
  )
}
