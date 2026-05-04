import { escapeHtml } from '@/lib/email/escape'

// Operator-facing notification fired on a TERMINAL payment failure.
// Counterpart to operator-payment-notify.ts (success).
//
// "Terminal" means the order will not move to `paid` afterwards:
//   - CloudPayments Fail webhook (markOrderFailed)
//   - 3DS callback decline (markOrderFailed)
//   - 3DS callback `invalid_state` (already non-pending)
//
// We deliberately do NOT fire on:
//   - validation failures (suspicious-but-not-terminal; handled by
//     audit + the aggregate webhook-flow alert)
//   - Check declines (Check is pre-pay; declines there are often
//     legit fraud-detector or insufficient-funds and would spam)
//   - charge_token sync errors (no invoice id available in some
//     branches)
//
// The aggregate webhook-flow-alert (every 30 min, fires on
// paid+fail/created < 0.3 with ≥5 created/hour) keeps watching the
// global trend; this template targets the per-event signal that the
// aggregate misses on low-volume days.

export type OperatorPaymentFailureParams = {
  invoiceId: string
  amountRub: number
  customerEmail: string
  // Source of the failure for the subject line / body — "fail webhook",
  // "3DS decline", "invalid 3DS state", etc.
  source: string
  // CloudPayments-provided reason text if any (e.g. "Insufficient
  // funds", "Stolen card"). Optional.
  reason?: string | null
  reasonCode?: string | number | null
  transactionId?: string | number | null
  customerComment?: string | null
  siteUrl: string
}

export function renderOperatorPaymentFailureEmail(
  params: OperatorPaymentFailureParams,
): { subject: string; html: string; text: string } {
  const amountFormatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(params.amountRub)

  const subject = `[LevelChannel] Платёж НЕ прошёл: ${amountFormatted} ₽ — ${params.invoiceId}`

  const reasonText = params.reason?.trim() || '—'
  const reasonCodeText =
    params.reasonCode === null || params.reasonCode === undefined
      ? '—'
      : String(params.reasonCode)
  const txText =
    params.transactionId === null || params.transactionId === undefined
      ? '—'
      : String(params.transactionId)
  const comment = params.customerComment?.trim() || ''

  const text = [
    `Платёж не завершился (${params.source}).`,
    '',
    `Сумма: ${amountFormatted} ₽`,
    `Invoice: ${params.invoiceId}`,
    `E-mail клиента: ${params.customerEmail}`,
    `Причина: ${reasonText}`,
    `Код причины: ${reasonCodeText}`,
    `Transaction id: ${txText}`,
    ...(comment ? [`Комментарий клиента: ${comment}`] : []),
    '',
    `Полная история заказа — psql / OPERATIONS.md §5.`,
    `Сайт: ${params.siteUrl}`,
  ].join('\n')

  const commentHtml = comment
    ? `<li>Комментарий клиента: <em>${escapeHtml(comment)}</em></li>`
    : ''

  const html = `<p>Платёж не завершился (<strong>${escapeHtml(params.source)}</strong>).</p>
<ul>
  <li>Сумма: <strong>${amountFormatted} ₽</strong></li>
  <li>Invoice: <code>${escapeHtml(params.invoiceId)}</code></li>
  <li>E-mail клиента: ${escapeHtml(params.customerEmail)}</li>
  <li>Причина: ${escapeHtml(reasonText)}</li>
  <li>Код причины: ${escapeHtml(reasonCodeText)}</li>
  <li>Transaction id: ${escapeHtml(txText)}</li>
  ${commentHtml}
</ul>
<p style="color:#777;font-size:12px;">Полная история заказа — psql / <code>OPERATIONS.md §5</code>.</p>`

  return { subject, html, text }
}
