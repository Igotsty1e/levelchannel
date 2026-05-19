'use client'

import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { SbpQrModal } from '@/components/payments/sbp-qr-modal'
import { logCheckoutEvent } from '@/lib/analytics/client'
import {
  PERSONAL_DATA_CONSENT_LABEL,
  PERSONAL_DATA_CONSENT_PATH,
} from '@/lib/legal/personal-data'
import {
  formatRubles,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  PAYMENT_COMMENT_MAX_LENGTH,
  normalizeCustomerEmail,
  validateCustomerComment,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import type {
  CloudPaymentsWidgetIntent,
  PublicPaymentOrder,
  PublicSavedCard,
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
  // Wave 6.1 #4 Phase 2 — server-issued receipt token. Returned ONCE
  // by POST /api/payments and held in component state for this tab
  // session. Threaded through GET / SSE / cancel calls. NOT persisted
  // to localStorage — a tab reload loses the token, and the order
  // falls into the 24h legacy-NULL-token grace window on the server
  // (so reload doesn't break the in-flight UX, but the token doesn't
  // outlive the tab either). Optional in the type so existing
  // setCheckout({...}) call sites that reset / error out don't need
  // to thread it; treat undefined as null on read.
  receiptToken?: string | null
}

function getSavedInvoiceId() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem('levelchannel:activePaymentInvoiceId')
  } catch {
    return null
  }
}

function getSavedCompletedInvoiceId() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem('levelchannel:lastCompletedPaymentInvoiceId')
  } catch {
    return null
  }
}

function saveInvoiceId(invoiceId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (invoiceId) {
      window.localStorage.setItem('levelchannel:activePaymentInvoiceId', invoiceId)
      return
    }

    window.localStorage.removeItem('levelchannel:activePaymentInvoiceId')
  } catch {
    return
  }
}

function saveCompletedInvoiceId(invoiceId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (invoiceId) {
      window.localStorage.setItem('levelchannel:lastCompletedPaymentInvoiceId', invoiceId)
      return
    }

    window.localStorage.removeItem('levelchannel:lastCompletedPaymentInvoiceId')
  } catch {
    return
  }
}

// Перенаправляет браузер на ACS-страницу банка через auto-submit формы.
// PaReq и MD никогда не попадают в URL — только в тело POST. Поведение
// диктуется протоколом 3-D Secure 1.0.2 / EMV 3DS 2.x.
function submitThreeDsForm(params: {
  acsUrl: string
  paReq: string
  transactionId: string
  termUrl: string
}) {
  if (typeof document === 'undefined') {
    return
  }

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = params.acsUrl
  form.style.display = 'none'

  const fields: Record<string, string> = {
    PaReq: params.paReq,
    MD: params.transactionId,
    TermUrl: params.termUrl,
  }

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
}

async function fetchOrder(invoiceId: string, receiptToken: string | null) {
  // Wave 6.1 #4 Phase 2 — pass the token via X-Receipt-Token header
  // so it never lands in access logs. Fall through silently when the
  // token is absent (legacy in-flight orders ride the 24h server
  // grace; new orders without a token mean the tab reloaded — the
  // server will return 401, the UI shows "no longer pending" path).
  const response = await fetch(`/api/payments/${invoiceId}`, {
    cache: 'no-store',
    headers: receiptToken ? { 'X-Receipt-Token': receiptToken } : undefined,
  })

  const payload = (await response.json()) as {
    order?: PublicPaymentOrder
    error?: string
    message?: string
  }

  if (!response.ok || !payload.order) {
    throw new Error(payload.message || payload.error || 'Не удалось получить статус оплаты.')
  }

  return payload.order
}

async function cancelOrder(invoiceId: string, receiptToken: string | null) {
  const response = await fetch(`/api/payments/${invoiceId}/cancel`, {
    method: 'POST',
    cache: 'no-store',
    headers: receiptToken ? { 'X-Receipt-Token': receiptToken } : undefined,
  })

  const payload = (await response.json()) as {
    ok?: boolean
    error?: string
    message?: string
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'Не удалось сбросить платёж.')
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
  const [comment, setComment] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [amountTouched, setAmountTouched] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)
  const [failedInvoiceId, setFailedInvoiceId] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<CheckoutState>({
    phase: 'idle',
    order: null,
    error: null,
  })
  const [savedCard, setSavedCard] = useState<PublicSavedCard | null>(null)
  const [oneClickPending, setOneClickPending] = useState(false)
  // Карта по умолчанию НЕ запоминается. Чекбокс — opt-in.
  const [rememberCard, setRememberCard] = useState(false)
  const [personalDataConsentAccepted, setPersonalDataConsentAccepted] = useState(false)
  const [personalDataConsentTouched, setPersonalDataConsentTouched] = useState(false)
  // SBP-PAY (2026-05-19) — modal-state for the second CTA. The modal
  // mounts when sbpModal !== null and renders the QR + status-poll.
  // The server-issued accountIdAttached boolean pins isGuest at order-
  // create time (§0b WARN#3 closure).
  const [sbpModal, setSbpModal] = useState<{
    invoiceId: string
    qrUrl: string
    image: string | null
    receiptToken: string
    isGuest: boolean
  } | null>(null)
  const [sbpPending, setSbpPending] = useState(false)

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
  const personalDataConsentError =
    personalDataConsentTouched && !personalDataConsentAccepted
      ? 'Чтобы перейти к оплате, подтвердите согласие на обработку персональных данных.'
      : null
  const commentValidation = validateCustomerComment(comment)
  const commentError = commentValidation.ok ? null : commentValidation.message
  const commentLength = comment.trim().length
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
    const invoiceId = failedInvoiceId || getSavedInvoiceId() || getSavedCompletedInvoiceId()

    if (!invoiceId) {
      return
    }

    // No saved token after a tab reload — order rides the server's
    // 24h legacy grace window. After that the server returns 401 and
    // the .catch() branch below treats it as "no longer pending."
    fetchOrder(invoiceId, null)
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

        if (order.status === 'paid') {
          saveCompletedInvoiceId(order.invoiceId)
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

  // Подгружаем сохранённую карту, когда e-mail валиден. Endpoint защищён
  // origin-check + rate-limit; всё равно дебаунсим, чтобы не светить тем,
  // кто просто опечатался.
  useEffect(() => {
    if (!emailValidation.ok) {
      setSavedCard(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/payments/saved-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerEmail: emailValidation.email }),
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) setSavedCard(null)
          return
        }

        const payload = (await response.json()) as { savedCard?: PublicSavedCard | null }

        if (!cancelled) {
          setSavedCard(payload.savedCard || null)
        }
      } catch {
        if (!cancelled) setSavedCard(null)
      }
    }, 500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [emailValidation.ok, emailValidation.ok ? emailValidation.email : ''])

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== 'pending') {
      return
    }

    // Idempotent reducer: takes a fresh order, advances UI state if the
    // status moved off pending. Called by both the SSE push path AND
    // the slow-poll fallback. Calling it twice with the same order is
    // a no-op (React's setState short-circuits on shallow-equal refs
    // when nothing changed; we always pass the new ref so the latest
    // serverSide updatedAt sticks).
    const applyOrder = (order: PublicPaymentOrder) => {
      if (order.status === 'cancelled') {
        saveInvoiceId(null)
        setCheckout({
          phase: 'idle',
          order: null,
          error: 'Оплата не завершена. Можно попробовать ещё раз.',
        })
        return
      }

      if (order.status === 'paid') {
        saveCompletedInvoiceId(order.invoiceId)
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
    }

    // Push path: SSE stream from /api/payments/[invoiceId]/stream.
    // EventSource reconnects automatically on transport errors;
    // the slow-poll below is a belt-and-suspenders fallback for
    // ad-blockers / corporate proxies that strip SSE responses.
    //
    // Wave 6.1 #4 Phase 2 — receipt token threaded as `?token=...`
    // because EventSource cannot set custom headers. Token absent
    // (e.g. after tab reload) → server's 24h legacy grace window
    // covers the in-flight UX; past that, SSE init returns 401.
    let eventSource: EventSource | null = null
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      const tokenParam = checkout.receiptToken
        ? `?token=${encodeURIComponent(checkout.receiptToken)}`
        : ''
      eventSource = new window.EventSource(
        `/api/payments/${encodeURIComponent(activeOrder.invoiceId)}/stream${tokenParam}`,
      )
      eventSource.addEventListener('status', (rawEvent) => {
        try {
          const event = rawEvent as MessageEvent
          const data = JSON.parse(event.data) as { order?: PublicPaymentOrder }
          if (data.order) applyOrder(data.order)
        } catch {
          // Malformed frame — ignore; slow-poll will catch up.
        }
      })
      // Errors are silent: EventSource auto-retries; if the network is
      // truly down, the slow poll will surface the error path below.
    }

    // Slow-poll fallback (10s). Pre-SSE this was 4s; SSE makes the
    // tight cadence unnecessary, but we keep a coarse safety net.
    const interval = window.setInterval(() => {
      fetchOrder(activeOrder.invoiceId, checkout.receiptToken ?? null)
        .then(applyOrder)
        .catch((error) => {
          setCheckout((current) => ({
            ...current,
            error: error instanceof Error ? error.message : 'Ошибка статуса оплаты.',
          }))
        })
    }, 10_000)

    return () => {
      window.clearInterval(interval)
      eventSource?.close()
    }
    // checkout.receiptToken is read here for the SSE/poll path; we
    // include it in deps so a token captured AFTER the activeOrder
    // arrives (sub-microsecond, but still) re-runs the effect with
    // the right URL/header. eslint-disable on activeOrder to keep the
    // existing behaviour: the effect re-binds when the order changes,
    // not when the order's nested fields update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder, checkout.receiptToken])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAmountTouched(true)
    setEmailTouched(true)
    setPersonalDataConsentTouched(true)

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

    if (!personalDataConsentAccepted) {
      setCheckout((current) => ({
        ...current,
        phase: 'idle',
        error: 'Подтвердите согласие на обработку персональных данных.',
      }))
      return
    }

    setCheckout((current) => ({
      ...current,
      phase: 'creating',
      error: null,
    }))

    try {
      const entropy =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const idempotencyKey = `lc-create-${entropy}`
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          amountRub,
          customerEmail: emailValidation.email,
          rememberCard,
          personalDataConsentAccepted,
          customerComment: commentValidation.ok ? commentValidation.comment : null,
        }),
      })

      const payload = (await response.json()) as {
        order?: PublicPaymentOrder
        checkoutIntent?: CloudPaymentsWidgetIntent | null
        receiptToken?: string
        error?: string
        message?: string
      }

      if (!response.ok || !payload.order) {
        throw new Error(payload.message || payload.error || 'Не удалось создать платёж.')
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
        // Wave 6.1 #4 Phase 2 — capture the plain receipt token from
        // the create-order response. This is the only moment we ever
        // see it; the server keeps only the sha256 hash. Stored in
        // checkout state, threaded through SSE / cancel / redirect
        // below.
        receiptToken: payload.receiptToken ?? null,
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
        saveCompletedInvoiceId(payload.order.invoiceId)
        void logCheckoutEvent({
          type: 'checkout_widget_success',
          invoiceId: payload.order.invoiceId,
          amountRub: payload.order.amountRub,
          email: emailValidation.email,
          emailValid: true,
        })
        // Wave 6.1 #4 Phase 2 — thread the receipt token into
        // /thank-you so its `fetchOrder` polls succeed past the
        // 24h legacy-grace window. Token in URL is acceptable
        // here — same-origin, post-auth, short-lived; first-comment
        // / link-share patterns don't apply.
        const tokenParam = payload.receiptToken
          ? `&token=${encodeURIComponent(payload.receiptToken)}`
          : ''
        router.push(
          `/thank-you?invoiceId=${encodeURIComponent(payload.order.invoiceId)}${tokenParam}`,
        )
        return
      }

      if (widgetResult.type === 'cancel' || widgetResult.status === 'cancel') {
        try {
          await cancelOrder(payload.order.invoiceId, payload.receiptToken ?? null)
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

  async function handleOneClick() {
    setAmountTouched(true)
    setEmailTouched(true)
    setPersonalDataConsentTouched(true)

    if (!amountIsValid || !emailValidation.ok) {
      setCheckout((current) => ({
        ...current,
        error: !amountIsValid
          ? `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`
          : emailValidation.message || 'Укажите корректный e-mail.',
      }))
      return
    }

    if (hasLockedPendingOrder) {
      return
    }

    if (!personalDataConsentAccepted) {
      setCheckout((current) => ({
        ...current,
        error: 'Подтвердите согласие на обработку персональных данных.',
      }))
      return
    }

    void logCheckoutEvent({
      type: 'checkout_one_click_clicked',
      amountRub: Number(amountRub),
      email: emailValidation.email,
      emailValid: true,
    })

    setOneClickPending(true)
    setCheckout((current) => ({ ...current, error: null }))

    try {
      const idempotencyKey = `lc-charge-${crypto.randomUUID()}`
      const response = await fetch('/api/payments/charge-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          amountRub: Number(amountRub),
          customerEmail: emailValidation.email,
          personalDataConsentAccepted,
        }),
        cache: 'no-store',
      })

      // Wave 16 — charge-token contract polish: success/202 use
      // `status` (paid / requires_3ds); 4xx use `error`. Decline used
      // to be `status: 'declined'` and is now `error: 'declined'`
      // for symmetry with the rest of /api/payments/* (Codex Pass 2 #16).
      const payload = (await response.json()) as {
        order?: PublicPaymentOrder
        status?: 'paid' | 'requires_3ds'
        message?: string
        error?: string
        threeDs?: {
          acsUrl: string
          paReq: string
          transactionId: string
          termUrl: string
        }
      }

      if (response.status === 404) {
        setSavedCard(null)
        setCheckout((current) => ({
          ...current,
          error:
            payload.message ||
            payload.error ||
            'Сохранённая карта не найдена. Оплатите обычным способом.',
        }))
        return
      }

      if (!response.ok && payload.error !== 'declined') {
        throw new Error(payload.message || payload.error || 'Не удалось списать с сохранённой карты.')
      }

      if (payload.status === 'paid' && payload.order) {
        saveCompletedInvoiceId(payload.order.invoiceId)
        void logCheckoutEvent({
          type: 'checkout_one_click_paid',
          invoiceId: payload.order.invoiceId,
          amountRub: payload.order.amountRub,
          email: emailValidation.email,
          emailValid: true,
        })
        setCheckout({ phase: 'idle', order: payload.order, error: null })
        router.push(`/thank-you?invoiceId=${encodeURIComponent(payload.order.invoiceId)}`)
        return
      }

      if (payload.status === 'requires_3ds' && payload.order && payload.threeDs) {
        void logCheckoutEvent({
          type: 'checkout_one_click_3ds_started',
          invoiceId: payload.order.invoiceId,
          amountRub: payload.order.amountRub,
          email: emailValidation.email,
          emailValid: true,
          reason: '3ds_required',
        })
        // Сохраняем invoiceId как активный pending — если пользователь
        // вернётся с фейлом, мы его подхватим через polling.
        saveInvoiceId(payload.order.invoiceId)
        submitThreeDsForm(payload.threeDs)
        // Браузер уйдёт на acsUrl, дальнейший код не выполнится.
        return
      }

      if (payload.error === 'declined' && payload.order) {
        void logCheckoutEvent({
          type: 'checkout_one_click_declined',
          invoiceId: payload.order.invoiceId,
          amountRub: payload.order.amountRub,
          email: emailValidation.email,
          emailValid: true,
          message: payload.message,
        })
        setCheckout({
          phase: 'idle',
          order: payload.order,
          error: payload.message || 'Платёж отклонён банком.',
        })
        return
      }

      throw new Error(payload.message || payload.error || 'Не удалось обработать платёж.')
    } catch (error) {
      void logCheckoutEvent({
        type: 'checkout_one_click_failed',
        amountRub: Number(amountRub),
        email: emailValidation.email,
        emailValid: true,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      setCheckout((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Не удалось списать с карты.',
      }))
    } finally {
      setOneClickPending(false)
    }
  }

  async function forgetSavedCard() {
    if (!emailValidation.ok || !savedCard) {
      return
    }

    void logCheckoutEvent({
      type: 'checkout_saved_card_forget_clicked',
      email: emailValidation.email,
      emailValid: true,
    })

    try {
      const response = await fetch('/api/payments/saved-card', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerEmail: emailValidation.email }),
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error('Не удалось удалить сохранённую карту.')
      }

      setSavedCard(null)
      setCheckout((current) => ({
        ...current,
        error: 'Сохранённая карта удалена.',
      }))
    } catch (error) {
      setCheckout((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Не удалось удалить карту.',
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
      const order = await fetchOrder(
        activeOrder.invoiceId,
        checkout.receiptToken ?? null,
      )

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
        saveCompletedInvoiceId(order.invoiceId)
        router.push(`/thank-you?invoiceId=${encodeURIComponent(order.invoiceId)}`)
      }
    } catch (error) {
      setCheckout((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Не удалось обновить статус.',
      }))
    }
  }

  function dismissCompletedPayment() {
    saveCompletedInvoiceId(null)
    setCheckout((current) => ({
      ...current,
      order: current.order?.status === 'paid' ? null : current.order,
    }))
  }

  async function resetPendingPayment() {
    if (!activeOrder) {
      return
    }

    try {
      await cancelOrder(activeOrder.invoiceId, checkout.receiptToken ?? null)
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

  // SBP-PAY (2026-05-19) — second CTA. POSTs to /api/payments/sbp/create-qr
  // with an Idempotency-Key generated per click (§0a BLOCKER#1 closure —
  // header is REQUIRED, the server 400s without it). On success the
  // modal mounts with the qrUrl + receiptToken + isGuest pin.
  async function handleSbpClick() {
    setAmountTouched(true)
    setEmailTouched(true)
    setPersonalDataConsentTouched(true)

    if (!amountIsValid || !emailValidation.ok) {
      setCheckout((current) => ({
        ...current,
        error: !amountIsValid
          ? `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`
          : emailValidation.message || 'Укажите корректный e-mail.',
      }))
      return
    }
    if (!personalDataConsentAccepted) {
      setCheckout((current) => ({
        ...current,
        error: 'Подтвердите согласие на обработку персональных данных.',
      }))
      return
    }

    setSbpPending(true)
    setCheckout((current) => ({ ...current, error: null }))

    try {
      const entropy =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const idempotencyKey = `lc-sbp-${entropy}`
      const response = await fetch('/api/payments/sbp/create-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          amountRub: Number(amountRub),
          customerEmail: emailValidation.email,
          customerComment: commentValidation.ok ? commentValidation.comment : null,
          personalDataConsentAccepted: true,
        }),
        cache: 'no-store',
      })

      const payload = (await response.json()) as {
        invoiceId?: string
        qrUrl?: string
        image?: string | null
        receiptToken?: string
        accountIdAttached?: boolean
        error?: string
        message?: string
      }

      if (!response.ok || !payload.invoiceId || !payload.qrUrl || !payload.receiptToken) {
        throw new Error(
          payload.message ||
            payload.error ||
            'Не удалось создать СБП-платёж. Попробуйте ещё раз.',
        )
      }

      setSbpModal({
        invoiceId: payload.invoiceId,
        qrUrl: payload.qrUrl,
        image: payload.image ?? null,
        receiptToken: payload.receiptToken,
        isGuest: payload.accountIdAttached === false,
      })
    } catch (error) {
      setCheckout((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось создать СБП-платёж. Попробуйте ещё раз.',
      }))
    } finally {
      setSbpPending(false)
    }
  }

  function closeSbpModal() {
    setSbpModal(null)
  }

  function onSbpPaid() {
    if (!sbpModal) return
    const tokenParam = sbpModal.receiptToken
      ? `&token=${encodeURIComponent(sbpModal.receiptToken)}`
      : ''
    router.push(
      `/thank-you?invoiceId=${encodeURIComponent(sbpModal.invoiceId)}${tokenParam}`,
    )
  }

  function onSbpFailed(reason?: string) {
    setCheckout((current) => ({
      ...current,
      error:
        reason && reason !== 'cancelled' && reason !== 'receipt_token_mismatch'
          ? reason
          : 'Оплата через СБП не прошла. Попробуйте ещё раз.',
    }))
  }

  function onSbpTimeout() {
    setCheckout((current) => ({
      ...current,
      error:
        'Истёк лимит ожидания СБП-оплаты. Если деньги списались — придёт чек на e-mail. Иначе попробуйте ещё раз.',
    }))
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

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#D4D4D8', fontWeight: 600 }}>
                Комментарий{' '}
                <span style={{ color: '#A1A1AA', fontWeight: 400 }}>(не обязательно)</span>
              </span>
              <input
                type="text"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                disabled={isLoading || hasLockedPendingOrder}
                maxLength={PAYMENT_COMMENT_MAX_LENGTH}
                placeholder="например: за занятие 26 апреля"
                style={inputStyle(Boolean(commentError))}
                aria-invalid={commentError ? true : undefined}
              />
              <span style={commentError ? fieldErrorStyle : fieldHintStyle}>
                {commentError
                  ? commentError
                  : `Появится в назначении платежа. Осталось ${PAYMENT_COMMENT_MAX_LENGTH - commentLength} симв.`}
              </span>
            </label>

            {!savedCard ? (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: 13,
                  color: '#A1A1AA',
                  lineHeight: 1.45,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  className="payment-form-checkbox"
                  checked={rememberCard}
                  onChange={(event) => setRememberCard(event.target.checked)}
                  disabled={isLoading || hasLockedPendingOrder}
                />
                <span>
                  Запомнить карту, чтобы в следующий раз оплатить в один клик.
                  Карту сохраняет CloudPayments, у нас — только токен.
                </span>
              </label>
            ) : null}

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 13,
                color: '#A1A1AA',
                lineHeight: 1.45,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                className="payment-form-checkbox"
                checked={personalDataConsentAccepted}
                onChange={(event) => setPersonalDataConsentAccepted(event.target.checked)}
                onBlur={() => setPersonalDataConsentTouched(true)}
                disabled={isLoading || hasLockedPendingOrder || oneClickPending}
                required
              />
              <span>
                {PERSONAL_DATA_CONSENT_LABEL}{' '}
                <a href={PERSONAL_DATA_CONSENT_PATH} style={inlineLinkStyle}>
                  Текст согласия
                </a>
                .
              </span>
            </label>
            {personalDataConsentError ? (
              <span style={fieldErrorStyle}>{personalDataConsentError}</span>
            ) : null}

            {savedCard && !hasLockedPendingOrder ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleOneClick}
                  disabled={
                    isLoading || oneClickPending || !amountIsValid || !emailValidation.ok
                  }
                  style={buttonStyle(
                    isLoading || oneClickPending || !amountIsValid || !emailValidation.ok,
                  )}
                >
                  {oneClickPending
                    ? 'Списываем с сохранённой карты…'
                    : `Оплатить картой ··${savedCard.cardLastFour || 'сохранённой'}`}
                </button>
                <button
                  type="button"
                  onClick={forgetSavedCard}
                  disabled={isLoading || oneClickPending}
                  style={{
                    appearance: 'none',
                    background: 'transparent',
                    color: '#A1A1AA',
                    border: 'none',
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: '4px 0',
                    textAlign: 'left',
                    textDecoration: 'underline',
                  }}
                >
                  Забыть эту карту
                </button>
              </div>
            ) : null}

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
                disabled={isLoading || hasLockedPendingOrder || oneClickPending}
                style={buttonStyle(isLoading || hasLockedPendingOrder || oneClickPending)}
              >
                {isLoading
                  ? 'Готовим платёж…'
                  : hasLockedPendingOrder
                    ? 'Сначала завершите текущий платёж'
                    : savedCard
                      ? 'Оплатить другой картой'
                      : 'Перейти к оплате'}
              </button>
              <button
                type="button"
                onClick={handleSbpClick}
                disabled={
                  isLoading ||
                  hasLockedPendingOrder ||
                  oneClickPending ||
                  sbpPending
                }
                style={secondaryCtaButtonStyle(
                  isLoading ||
                    hasLockedPendingOrder ||
                    oneClickPending ||
                    sbpPending,
                )}
              >
                {sbpPending ? 'Готовим QR-код…' : 'Оплатить через СБП'}
              </button>
              <div style={legalTextStyle}>
                Нажимая кнопку, вы подтверждаете согласие с{' '}
                <a href={PERSONAL_DATA_CONSENT_PATH} style={inlineLinkStyle}>
                  обработкой персональных данных
                </a>
                , а также с{' '}
                <a href="/offer" style={inlineLinkStyle}>
                  офертой
                </a>{' '}
                и{' '}
                <a href="/privacy" style={inlineLinkStyle}>
                  политикой персональных данных
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
              <>
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/thank-you?invoiceId=${encodeURIComponent(activeOrder.invoiceId)}`)
                  }
                  style={secondaryButtonStyle}
                >
                  Открыть подтверждение
                </button>
                <button
                  type="button"
                  onClick={dismissCompletedPayment}
                  style={ghostButtonStyle}
                >
                  Скрыть подтверждение
                </button>
              </>
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

      {sbpModal ? (
        <SbpQrModal
          invoiceId={sbpModal.invoiceId}
          qrUrl={sbpModal.qrUrl}
          image={sbpModal.image}
          receiptToken={sbpModal.receiptToken}
          isGuest={sbpModal.isGuest}
          onClose={closeSbpModal}
          onPaid={onSbpPaid}
          onFailed={onSbpFailed}
          onTimeout={onSbpTimeout}
        />
      ) : null}
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

// SBP-PAY (2026-05-19) — secondary CTA next to the primary card-flow
// "Перейти к оплате" button. Visually distinct (outlined, not solid)
// so the card flow remains the primary path until learner uptake
// data shifts the default.
function secondaryCtaButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    padding: '0 22px',
    borderRadius: 14,
    border: '1px solid rgba(232,168,144,0.55)',
    background: 'rgba(232,168,144,0.08)',
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
