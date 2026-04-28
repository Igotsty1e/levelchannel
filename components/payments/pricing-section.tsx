'use client'

import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { logCheckoutEvent } from '@/lib/analytics/client'
import {
  formatRubles,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  normalizeCustomerEmail,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import type {
  CloudPaymentsWidgetIntent,
  PublicPaymentOrder,
} from '@/lib/payments/types'

type CloudPaymentsWidgetResult = {
  type?: 'cancel' | 'payment' | 'installment' | 'error'
  status?: 'success' | 'fail' | 'appointment' | 'reject' | 'cancel'
  message?: string
  data?: {
    transactionId?: number
    ReasonCode?: number
  }
}

declare global {
  interface Window {
    cp?: {
      CloudPayments: new () => {
        oncomplete?: (result: CloudPaymentsWidgetResult) => void
        start: (intentParams: CloudPaymentsWidgetIntent) => Promise<CloudPaymentsWidgetResult>
      }
    }
  }
}

type CheckoutState = {
  phase: 'idle' | 'creating' | 'pending'
  order: PublicPaymentOrder | null
  error: string | null
}

function getSavedInvoiceId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem('levelchannel:activePaymentInvoiceId')
}

function saveInvoiceId(invoiceId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (invoiceId) {
    window.localStorage.setItem('levelchannel:activePaymentInvoiceId', invoiceId)
    return
  }

  window.localStorage.removeItem('levelchannel:activePaymentInvoiceId')
}

async function fetchOrder(invoiceId: string) {
  const response = await fetch(`/api/payments/${invoiceId}`, {
    cache: 'no-store',
  })

  const payload = (await response.json()) as {
    order?: PublicPaymentOrder
    error?: string
  }

  if (!response.ok || !payload.order) {
    throw new Error(payload.error || 'Не удалось получить статус оплаты.')
  }

  return payload.order
}

async function cancelOrder(invoiceId: string) {
  const response = await fetch(`/api/payments/${invoiceId}/cancel`, {
    method: 'POST',
    cache: 'no-store',
  })

  const payload = (await response.json()) as {
    ok?: boolean
    error?: string
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Не удалось сбросить платёж.')
  }
}

function cloudPaymentsReady() {
  return Boolean(window.cp?.CloudPayments)
}

async function openCloudPaymentsWidget(intent: CloudPaymentsWidgetIntent) {
  if (!cloudPaymentsReady()) {
    throw new Error('Платёжная форма CloudPayments не загрузилась. Обновите страницу и попробуйте снова.')
  }

  const widget = new window.cp!.CloudPayments()

  return new Promise<CloudPaymentsWidgetResult>((resolve, reject) => {
    let settled = false

    const finish = (result: CloudPaymentsWidgetResult) => {
      if (settled) {
        return
      }

      settled = true
      resolve(result)
    }

    widget.oncomplete = (result) => {
      finish(result || { type: 'cancel', status: 'cancel' })
    }

    widget
      .start(intent)
      .then((result) => {
        if (result?.status === 'success') {
          finish(result)
        }
      })
      .catch((error) => {
        if (settled) {
          return
        }

        settled = true
        reject(error)
      })
  })
}

export function PricingSection() {
  const router = useRouter()
  const [amountRub, setAmountRub] = useState('3500')
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [amountTouched, setAmountTouched] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)
  const [failedInvoiceId, setFailedInvoiceId] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<CheckoutState>({
    phase: 'idle',
    order: null,
    error: null,
  })

  const activeOrder = checkout.order
  const normalizedEmail = normalizeCustomerEmail(email)
  const emailValidation = validateCustomerEmail(normalizedEmail)
  const amountValue = Number(amountRub)
  const amountIsValid =
    Number.isFinite(amountValue) &&
    amountValue >= MIN_PAYMENT_AMOUNT_RUB &&
    amountValue <= MAX_PAYMENT_AMOUNT_RUB
  const amountError =
    amountTouched && !amountIsValid
      ? `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`
      : null
  const emailError = emailTouched && !emailValidation.ok ? emailValidation.message : null
  const emailHelperText = emailError
    ? emailError
    : 'На этот e-mail придёт электронный чек после успешной оплаты.'
  const hasLockedPendingOrder =
    checkout.phase === 'pending' && checkout.order?.status === 'pending'

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    setPaymentFailed(params.get('payment') === 'failed')
    setFailedInvoiceId(params.get('invoiceId'))
  }, [])

  useEffect(() => {
    const invoiceId = failedInvoiceId || getSavedInvoiceId()

    if (!invoiceId) {
      return
    }

    fetchOrder(invoiceId)
      .then((order) => {
        if (order.status === 'cancelled') {
          saveInvoiceId(null)
          setCheckout({
            phase: 'idle',
            order: null,
            error: paymentFailed ? 'Оплата не была завершена. Можно попробовать ещё раз.' : null,
          })
          return
        }

        setCheckout({
          phase: order.status === 'pending' ? 'pending' : 'idle',
          order,
          error: paymentFailed
            ? 'Оплата не была завершена. Можно попробовать ещё раз.'
            : null,
        })
      })
      .catch(() => {
        saveInvoiceId(null)
      })
  }, [failedInvoiceId, paymentFailed])

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== 'pending') {
      return
    }

    const interval = window.setInterval(() => {
      fetchOrder(activeOrder.invoiceId)
        .then((order) => {
          if (order.status === 'cancelled') {
            saveInvoiceId(null)
            setCheckout({
              phase: 'idle',
              order: null,
              error: 'Оплата не завершена. Можно попробовать ещё раз.',
            })
            return
          }

          setCheckout((current) => ({
            ...current,
            phase: order.status === 'pending' ? 'pending' : 'idle',
            order,
            error: current.error,
          }))

          if (order.status !== 'pending') {
            saveInvoiceId(null)
          }
        })
        .catch((error) => {
          setCheckout((current) => ({
            ...current,
            error: error instanceof Error ? error.message : 'Ошибка статуса оплаты.',
          }))
        })
    }, 4000)

    return () => window.clearInterval(interval)
  }, [activeOrder])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAmountTouched(true)
    setEmailTouched(true)

    void logCheckoutEvent({
      type: 'checkout_submit_clicked',
      amountRub: Number(amountRub),
      email: normalizedEmail,
      emailValid: emailValidation.ok,
      reason: emailValidation.ok ? undefined : emailValidation.reason,
    })

    if (hasLockedPendingOrder) {
      void logCheckoutEvent({
        type: 'checkout_submit_blocked_pending',
        invoiceId: checkout.order?.invoiceId,
        amountRub: checkout.order?.amountRub || Number(amountRub),
        email: normalizedEmail,
        emailValid: emailValidation.ok,
        reason: 'existing_pending_order',
      })
      setCheckout((current) => ({
        ...current,
        error: 'Сначала завершите или сбросьте текущий незавершённый платёж.',
      }))
      return
    }

    if (!amountIsValid || !emailValidation.ok) {
      setCheckout((current) => ({
        ...current,
        phase: 'idle',
        error:
          !amountIsValid
            ? `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`
            : emailValidation.message || 'Укажите корректный e-mail.',
      }))
      return
    }

    setCheckout((current) => ({
      ...current,
      phase: 'creating',
      error: null,
    }))

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amountRub,
          customerEmail: emailValidation.email,
        }),
      })

      const payload = (await response.json()) as {
        order?: PublicPaymentOrder
        checkoutIntent?: CloudPaymentsWidgetIntent | null
        error?: string
      }

      if (!response.ok || !payload.order) {
        throw new Error(payload.error || 'Не удалось создать платёж.')
      }

      saveInvoiceId(payload.order.invoiceId)
      void logCheckoutEvent({
        type: 'checkout_payment_created',
        invoiceId: payload.order.invoiceId,
        amountRub: payload.order.amountRub,
        email: emailValidation.email,
        emailValid: true,
      })

      setCheckout({
        phase: payload.order.status === 'pending' ? 'pending' : 'idle',
        order: payload.order,
        error: null,
      })

      if (payload.order.provider === 'mock' || !payload.checkoutIntent) {
        return
      }

      void logCheckoutEvent({
        type: 'checkout_widget_opened',
        invoiceId: payload.order.invoiceId,
        amountRub: payload.order.amountRub,
        email: emailValidation.email,
        emailValid: true,
      })

      const widgetResult = await openCloudPaymentsWidget(payload.checkoutIntent)

      if (widgetResult.status === 'success') {
        void logCheckoutEvent({
          type: 'checkout_widget_success',
          invoiceId: payload.order.invoiceId,
          amountRub: payload.order.amountRub,
          email: emailValidation.email,
          emailValid: true,
        })
        router.push(`/thank-you?invoiceId=${encodeURIComponent(payload.order.invoiceId)}`)
        return
      }

      if (widgetResult.type === 'cancel' || widgetResult.status === 'cancel') {
        try {
          await cancelOrder(payload.order.invoiceId)
          saveInvoiceId(null)
          void logCheckoutEvent({
            type: 'checkout_widget_cancelled',
            invoiceId: payload.order.invoiceId,
            amountRub: payload.order.amountRub,
            email: emailValidation.email,
            emailValid: true,
            reason: 'user_closed_widget',
          })
          setCheckout({
            phase: 'idle',
            order: null,
            error: 'Оплата не завершена: вы закрыли платёжную форму.',
          })
        } catch (cancelError) {
          void logCheckoutEvent({
            type: 'checkout_cancel_failed',
            invoiceId: payload.order.invoiceId,
            amountRub: payload.order.amountRub,
            email: emailValidation.email,
            emailValid: true,
            reason: 'cancel_route_failed',
            message:
              cancelError instanceof Error ? cancelError.message : 'cancel_route_failed',
          })
          setCheckout({
            phase: 'pending',
            order: payload.order,
            error: 'Не удалось корректно закрыть незавершённый платёж. Нажмите «Сбросить этот платёж».',
          })
        }
        return
      }

      saveInvoiceId(null)
      void logCheckoutEvent({
        type: 'checkout_widget_failed',
        invoiceId: payload.order.invoiceId,
        amountRub: payload.order.amountRub,
        email: emailValidation.email,
        emailValid: true,
        reason: widgetResult.status || widgetResult.type,
        message: widgetResult.message,
      })
      setCheckout({
        phase: 'idle',
        order: null,
        error: widgetResult.message || 'Оплата не прошла. Можно попробовать ещё раз.',
      })
    } catch (error) {
      void logCheckoutEvent({
        type: 'checkout_submit_failed',
        amountRub: Number(amountRub),
        email: normalizedEmail,
        emailValid: emailValidation.ok,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      setCheckout((current) => ({
        ...current,
        phase: 'idle',
        error: error instanceof Error ? error.message : 'Не удалось создать платёж.',
      }))
    }
  }

  async function refreshStatus() {
    if (!activeOrder) {
      return
    }

    void logCheckoutEvent({
      type: 'checkout_status_refresh_clicked',
      invoiceId: activeOrder.invoiceId,
      amountRub: activeOrder.amountRub,
      emailValid: true,
    })

    try {
      const order = await fetchOrder(activeOrder.invoiceId)

      if (order.status === 'cancelled') {
        saveInvoiceId(null)
        setCheckout({
          phase: 'idle',
          order: null,
          error: 'Оплата не завершена. Можно попробовать ещё раз.',
        })
        return
      }

      setCheckout({
        phase: order.status === 'pending' ? 'pending' : 'idle',
        order,
        error: null,
      })

      if (order.status === 'paid') {
        saveInvoiceId(null)
        router.push(`/thank-you?invoiceId=${encodeURIComponent(order.invoiceId)}`)
      }
    } catch (error) {
      setCheckout((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Не удалось обновить статус.',
      }))
    }
  }

  async function resetPendingPayment() {
    if (!activeOrder) {
      return
    }

    try {
      await cancelOrder(activeOrder.invoiceId)
      saveInvoiceId(null)
      void logCheckoutEvent({
        type: 'checkout_pending_reset_clicked',
        invoiceId: activeOrder.invoiceId,
        amountRub: activeOrder.amountRub,
        emailValid: true,
        reason: 'manual_reset',
      })
      setCheckout({
        phase: 'idle',
        order: null,
        error: 'Незавершённый платёж сброшен.',
      })
    } catch (error) {
      void logCheckoutEvent({
        type: 'checkout_pending_reset_failed',
        invoiceId: activeOrder.invoiceId,
        amountRub: activeOrder.amountRub,
        emailValid: true,
        reason: 'cancel_route_failed',
        message: error instanceof Error ? error.message : 'cancel_route_failed',
      })
      setCheckout((current) => ({
        ...current,
        error: 'Не удалось сбросить платёж. Попробуйте ещё раз.',
      }))
    }
  }

  const isLoading = checkout.phase === 'creating'
  const isPending = activeOrder?.status === 'pending'
  const isPaid = activeOrder?.status === 'paid'
  const isFailed = activeOrder?.status === 'failed'

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 28,
        padding: 'clamp(28px, 4vw, 40px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 'auto -10% -30% auto',
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,168,144,0.16) 0%, transparent 68%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 28,
        }}
      >
        <div>
          <span className="section-label">Оплата онлайн</span>
          <h3
            style={{
              fontSize: 'clamp(30px, 4.2vw, 44px)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              margin: '16px 0 12px',
            }}
          >
            Оплатить согласованную сумму
          </h3>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 16,
              lineHeight: 1.75,
              maxWidth: 560,
              marginBottom: 16,
            }}
          >
            Укажите сумму и e-mail. Платёж откроется прямо на сайте, а электронный чек
            после успешной оплаты отправит платёжный провайдер на этот e-mail.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 24,
            }}
          >
            {[
              `От ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽`,
              'Чек автоматически придёт на e-mail',
            ].map((item) => (
              <div
                key={item}
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.015)',
                  padding: '8px 12px',
                  color: '#A1A1AA',
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
              >
                {item}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#D4D4D8', fontWeight: 600 }}>Сумма, ₽</span>
              <input
                inputMode="decimal"
                name="amount"
                min={MIN_PAYMENT_AMOUNT_RUB}
                max={MAX_PAYMENT_AMOUNT_RUB}
                step="1"
                disabled={isLoading || hasLockedPendingOrder}
                value={amountRub}
                onChange={(event) => setAmountRub(event.target.value)}
                onBlur={() => setAmountTouched(true)}
                placeholder="Например, 3500"
                style={inputStyle(Boolean(amountError))}
                required
              />
              {amountError ? (
                <span style={fieldErrorStyle}>{amountError}</span>
              ) : null}
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#D4D4D8', fontWeight: 600 }}>
                E-mail для оплаты и чека
              </span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                disabled={isLoading || hasLockedPendingOrder}
                value={email}
                inputMode="email"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                onFocus={() => {
                  void logCheckoutEvent({
                    type: 'checkout_email_focus',
                    amountRub: Number(amountRub),
                    email: normalizeCustomerEmail(email),
                    emailValid: emailValidation.ok,
                  })
                }}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => {
                  setEmailTouched(true)
                  const nextValidation = validateCustomerEmail(normalizeCustomerEmail(email))
                  void logCheckoutEvent({
                    type: 'checkout_email_blur',
                    amountRub: Number(amountRub),
                    email: normalizeCustomerEmail(email),
                    emailValid: nextValidation.ok,
                    reason: nextValidation.ok ? undefined : nextValidation.reason,
                  })
                }}
                placeholder="you@example.com"
                style={inputStyle(Boolean(emailError))}
                aria-invalid={emailError ? true : undefined}
                required
              />
              <span style={emailError ? fieldErrorStyle : fieldHintStyle}>{emailHelperText}</span>
            </label>

            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                paddingTop: 4,
              }}
            >
              <button
                type="submit"
                disabled={isLoading || hasLockedPendingOrder}
                style={buttonStyle(isLoading || hasLockedPendingOrder)}
              >
                {isLoading
                  ? 'Готовим платёж…'
                  : hasLockedPendingOrder
                    ? 'Сначала завершите текущий платёж'
                    : 'Перейти к оплате'}
              </button>
              <div style={legalTextStyle}>
                Нажимая кнопку, вы соглашаетесь с{' '}
                <a href="/offer" style={inlineLinkStyle}>
                  офертой
                </a>{' '}
                и{' '}
                <a href="/privacy" style={inlineLinkStyle}>
                  политикой конфиденциальности
                </a>
                .
              </div>
            </div>
          </form>

          {checkout.error ? (
            <p style={{ color: '#FCA5A5', fontSize: 14, marginTop: 18 }}>{checkout.error}</p>
          ) : null}
        </div>

        {activeOrder ? (
          <aside
            style={{
              borderRadius: 24,
              padding: 24,
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 18,
              alignContent: 'start',
            }}
          >
            <StatusPill
              tone={
                isPaid ? 'success' : isFailed ? 'danger' : isPending ? 'warning' : 'neutral'
              }
            >
              {isPaid
                ? 'Оплата подтверждена'
                : isFailed
                  ? 'Оплата не завершена'
                  : isPending
                    ? 'Ожидаем завершение оплаты'
                    : 'Платёж ещё не создан'}
            </StatusPill>

            <div>
              <p style={{ fontSize: 13, color: '#71717A', marginBottom: 8 }}>Сумма</p>
              <p style={{ fontSize: 20, fontWeight: 800 }}>
                {formatRubles(activeOrder.amountRub)} ₽
              </p>
              <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.65, marginTop: 10 }}>
                {activeOrder.providerMessage || activeOrder.description}
              </p>
            </div>

            <div
              style={{
                borderRadius: 18,
                padding: '16px 18px',
                background: 'rgba(11,11,12,0.4)',
                border: '1px solid rgba(255,255,255,0.04)',
                display: 'grid',
                gap: 10,
              }}
            >
              <InfoRow label="Статус" value={statusLabel(activeOrder.status)} />
              {activeOrder.status !== 'pending' ? (
                <InfoRow
                  label="Обновлён"
                  value={new Date(activeOrder.updatedAt).toLocaleString('ru-RU')}
                />
              ) : null}
            </div>

            {isPending ? (
              <>
                <button type="button" onClick={refreshStatus} style={secondaryButtonStyle}>
                  Проверить статус
                </button>
                <p style={pendingHelpTextStyle}>
                  Если форму закрыли и списания не было, можно сбросить незавершённый платёж.
                </p>
                <button type="button" onClick={resetPendingPayment} style={ghostButtonStyle}>
                  Сбросить незавершённый платёж
                </button>
              </>
            ) : null}

            {isPaid ? (
              <button
                type="button"
                onClick={() =>
                  router.push(`/thank-you?invoiceId=${encodeURIComponent(activeOrder.invoiceId)}`)
                }
                style={secondaryButtonStyle}
              >
                Открыть подтверждение
              </button>
            ) : null}
          </aside>
        ) : (
          <aside style={trustCardStyle}>
            <p style={{ fontSize: 12, color: '#E8A890', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Безопасная оплата
            </p>
            <h4 style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15, marginTop: 10 }}>
              Форма откроется поверх сайта
            </h4>
            <p style={{ color: '#A1A1AA', fontSize: 15, lineHeight: 1.75, marginTop: 10 }}>
              После успешной оплаты чек автоматически придёт на e-mail. Если форму закрыть,
              платёж не будет считаться завершённым.
            </p>
          </aside>
        )}
      </div>
    </section>
  )
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
}) {
  const tones = {
    neutral: ['rgba(255,255,255,0.06)', '#D4D4D8'],
    success: ['rgba(74, 222, 128, 0.12)', '#86EFAC'],
    warning: ['rgba(250, 204, 21, 0.12)', '#FDE68A'],
    danger: ['rgba(248, 113, 113, 0.12)', '#FCA5A5'],
  } as const

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        width: 'fit-content',
        padding: '8px 12px',
        borderRadius: 999,
        background: tones[tone][0],
        color: tones[tone][1],
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: tones[tone][1],
        }}
      />
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'baseline',
      }}
    >
      <span style={{ color: '#71717A', fontSize: 13 }}>{label}</span>
      <span
        style={{
          color: '#E4E4E7',
          fontSize: 13,
          fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
          textAlign: 'right',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function statusLabel(status: PublicPaymentOrder['status']) {
  switch (status) {
    case 'paid':
      return 'Оплачен'
    case 'failed':
      return 'Неуспешно'
    case 'cancelled':
      return 'Отменён'
    default:
      return 'Ожидает оплаты'
  }
}

function inputStyle(hasError: boolean): CSSProperties {
  return {
    width: '100%',
    minHeight: 54,
    borderRadius: 14,
    border: hasError ? '1px solid rgba(248,113,113,0.7)' : '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    padding: '0 16px',
    fontSize: 16,
    outline: 'none',
  }
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    padding: '0 22px',
    borderRadius: 14,
    border: 'none',
    background: 'linear-gradient(135deg, #C87878 0%, #E8A890 100%)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.75 : 1,
  }
}

const secondaryButtonStyle: CSSProperties = {
  minHeight: 46,
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

const ghostButtonStyle: CSSProperties = {
  minHeight: 42,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'transparent',
  color: '#A1A1AA',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const trustCardStyle: CSSProperties = {
  borderRadius: 24,
  padding: 28,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
}

const fieldHintStyle: CSSProperties = {
  color: '#71717A',
  fontSize: 12,
  lineHeight: 1.45,
}

const fieldErrorStyle: CSSProperties = {
  color: '#FCA5A5',
  fontSize: 13,
  lineHeight: 1.5,
  fontWeight: 600,
}

const inlineLinkStyle: CSSProperties = {
  color: '#E8A890',
  textDecoration: 'none',
}

const legalTextStyle: CSSProperties = {
  color: '#5F5F67',
  fontSize: 12,
  lineHeight: 1.55,
  maxWidth: 420,
}

const pendingHelpTextStyle: CSSProperties = {
  color: '#71717A',
  fontSize: 12,
  lineHeight: 1.55,
  marginTop: -4,
}
