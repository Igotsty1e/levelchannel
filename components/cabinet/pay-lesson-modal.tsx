'use client'

// teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
//
// Модал оплаты конкретного занятия. Открывается из «Мои занятия» по
// кнопке «Оплатить N₽». Загружает SBP-реквизиты учителя через
// GET /api/learner/payment-context/[slotId], после нажатия «Я оплатил»
// создаёт claim через POST /api/learner/payment-claims.

import { useEffect, useRef, useState } from 'react'

import { Button, Banner, Modal } from '@/components/ui/primitives'
import { localizePayError } from '@/lib/i18n/payment-errors'
import { useFocusTrap } from '@/lib/util/focus-trap'

export type PayLessonModalProps = {
  slotId: string
  onClose: () => void
  onSuccess: () => void
}

type PayContext = {
  teacherAccountId: string
  teacherName: string
  slotLabel: string
  expectedAmountKopecks: number
  // 2026-06-17 prod-fix: paymentMethod включает id, иначе SBP-claim
  // получит 400 method_required_for_sbp.
  paymentMethod:
    | { id: string; phoneDisplay: string; bankLabel: string }
    | null
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

export function PayLessonModal({
  slotId,
  onClose,
  onSuccess,
}: PayLessonModalProps) {
  const [ctx, setCtx] = useState<PayContext | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [showOtherChannel, setShowOtherChannel] = useState(false)
  const [otherNote, setOtherNote] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const trapRef = useRef<HTMLDivElement | null>(null)
  // 2026-06-17 fix (audit BUG A): синхронный guard от двойного клика
  // на «Я оплатил». State `busy` обновляется асинхронно — между двумя
  // кликами в одном tick'е оба видят `busy === false` и оба уходят
  // в POST → 2-я заявка получает 409 «slot_has_active_claim».
  // Ref проверяется синхронно ДО первого await.
  const submittingRef = useRef(false)
  useFocusTrap(trapRef, () => (busy ? undefined : onClose()))

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch(`/api/learner/payment-context/${slotId}`, {
          cache: 'no-store',
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          if (!cancelled) {
            setLoadErr(localizePayError(data?.error) || `Ошибка ${r.status}`)
          }
          return
        }
        const body = await r.json()
        if (!cancelled) setCtx(body)
      } catch (e) {
        if (!cancelled) {
          setLoadErr(
            e instanceof Error
              ? 'Не удалось соединиться с сервером. Проверьте интернет.'
              : 'Неизвестная ошибка.',
          )
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [slotId])

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      // ignore — older browser
    }
  }

  async function submit(channel: 'sbp' | 'other') {
    // Sync guard (BUG A): возвращаемся ДО setBusy если уже летим.
    if (submittingRef.current || busy || !ctx) return
    submittingRef.current = true
    setBusy(true)
    setSubmitErr(null)
    try {
      const body: Record<string, unknown> = {
        teacherAccountId: ctx.teacherAccountId,
        amountKopecks: ctx.expectedAmountKopecks,
        paymentChannel: channel,
        items: [
          {
            slotId,
            expectedAmountKopecks: ctx.expectedAmountKopecks,
          },
        ],
      }
      // 2026-06-17 prod-fix: для SBP сервер требует paymentMethodId.
      // Раньше клиент его не слал → 400 method_required_for_sbp.
      if (channel === 'sbp' && ctx.paymentMethod) {
        body.paymentMethodId = ctx.paymentMethod.id
      }
      if (channel === 'other' && otherNote.trim()) {
        body.note = otherNote.trim()
      }
      const r = await fetch('/api/learner/payment-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        // 2026-06-17 prod-fix: «Ошибка 400.» ничего не говорит ученику.
        // localizePayError должен покрывать все известные 400-reasons.
        // Fallback на случай regression — дружелюбный generic, а не code.
        setSubmitErr(
          localizePayError(data?.error)
            || 'Не удалось оформить заявку. Обновите страницу и попробуйте снова.',
        )
        return
      }
      onSuccess()
    } catch (e) {
      setSubmitErr(
        e instanceof Error
          ? 'Не удалось соединиться с сервером. Проверьте интернет.'
          : 'Неизвестная ошибка.',
      )
    } finally {
      setBusy(false)
      submittingRef.current = false
    }
  }

  return (
    <Modal open={true} onClose={onClose} busy={busy} title="Оплата занятия" size="md">
        {ctx ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              margin: 0,
              marginBottom: 16,
            }}
          >
            учителю {ctx.teacherName} · {ctx.slotLabel}
          </p>
        ) : null}

        {loadErr ? <Banner tone="warning">{loadErr}</Banner> : null}

        {!ctx && !loadErr ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загружаем реквизиты…</p>
        ) : null}

        {ctx ? (
          <>
            <div
              style={{
                background: 'var(--accent-bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--secondary)',
                  marginBottom: 6,
                }}
              >
                К оплате
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                <span>{formatRub(ctx.expectedAmountKopecks)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      String(Math.round(ctx.expectedAmountKopecks / 100)),
                      'amount',
                    )
                  }
                >
                  {copiedKey === 'amount' ? 'Скопировано' : 'Скопировать'}
                </Button>
              </div>
            </div>

            {ctx.paymentMethod ? (
              <>
                <p
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 13,
                    margin: 0,
                    marginBottom: 12,
                    lineHeight: 1.6,
                  }}
                >
                  Переведите эту сумму по СБП через приложение вашего банка.
                  После перевода нажмите «Я оплатил(а)» — учитель увидит
                  заявку и подтвердит её.
                </p>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 14,
                    marginBottom: 16,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--secondary)',
                          marginBottom: 2,
                        }}
                      >
                        Телефон
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>
                        {ctx.paymentMethod.phoneDisplay}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(ctx.paymentMethod!.phoneDisplay, 'phone')
                      }
                    >
                      {copiedKey === 'phone' ? 'Скопировано' : 'Скопировать'}
                    </Button>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--secondary)',
                        marginBottom: 2,
                      }}
                    >
                      Банк
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>
                      {ctx.paymentMethod.bankLabel}
                    </div>
                  </div>
                </div>

                {ctx.expectedAmountKopecks < 10000 ? (
                  <p
                    style={{
                      color: 'var(--warning)',
                      fontSize: 12,
                      margin: 0,
                      marginBottom: 12,
                    }}
                  >
                    Большинство банков не пропускают СБП-переводы менее 100 ₽.
                  </p>
                ) : null}
              </>
            ) : (
              <Banner tone="warning">
                Учитель пока не настроил приём оплат через платформу. Свяжитесь
                с ним напрямую — после перевода можете зафиксировать оплату
                здесь.
              </Banner>
            )}

            {showOtherChannel ? (
              <div style={{ marginBottom: 16 }}>
                <label
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
                  Каким способом оплатили
                </label>
                <textarea
                  value={otherNote}
                  onChange={(e) => setOtherNote(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Например: наличные при встрече, перевод на карту"
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
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ) : null}

            {submitErr ? (
              <p
                style={{
                  color: 'var(--danger)',
                  fontSize: 13,
                  margin: 0,
                  marginBottom: 12,
                }}
              >
                {submitErr}
              </p>
            ) : null}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <Button variant="ghost" onClick={onClose} disabled={busy} type="button">
                Закрыть
              </Button>
              {!showOtherChannel ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowOtherChannel(true)}
                  disabled={busy}
                  type="button"
                >
                  Оплатил другим способом
                </Button>
              ) : null}
              {showOtherChannel ? (
                <Button
                  onClick={() => submit('other')}
                  disabled={busy || otherNote.trim().length < 3}
                  type="button"
                >
                  {busy ? 'Сохраняем…' : 'Зафиксировать'}
                </Button>
              ) : ctx.paymentMethod ? (
                <Button
                  onClick={() => submit('sbp')}
                  disabled={busy}
                  type="button"
                >
                  {busy ? 'Сохраняем…' : 'Я оплатил(а)'}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
    </Modal>
  )
}
