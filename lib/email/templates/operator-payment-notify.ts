import { escapeHtml } from '@/lib/email/escape'

// Operator-facing notification fired when a CloudPayments Pay webhook
// successfully transitions an order to `paid`. Different shape from
// the customer-facing receipt (which CloudKassir handles) — this is
// internal "money landed" pulse so the operator doesn't have to keep
// the dashboard open.

export type OperatorPaymentNotifyParams = {
  invoiceId: string
  amountRub: number
  customerEmail: string
  transactionId?: string | number | null
  paymentMethod?: string | null
  // Public site origin so links in the email work regardless of where
  // the operator opens it. Caller passes paymentConfig.siteUrl.
  siteUrl: string
}

export function renderOperatorPaymentNotifyEmail(
  params: OperatorPaymentNotifyParams,
): { subject: string; html: string; text: string } {
  const amountFormatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(params.amountRub)

  const subject = `[LevelChannel] Платёж получен: ${amountFormatted} ₽ — ${params.invoiceId}`

  const txLine = params.transactionId
    ? `Transaction id: ${escapeHtml(String(params.transactionId))}`
    : 'Transaction id: —'
  const methodLine = params.paymentMethod
    ? `Способ: ${escapeHtml(String(params.paymentMethod))}`
    : 'Способ: —'

  const text = [
    'Платёж успешно подтверждён CloudPayments.',
    '',
    `Сумма: ${amountFormatted} ₽`,
    `Invoice: ${params.invoiceId}`,
    `E-mail клиента: ${params.customerEmail}`,
    txLine,
    methodLine,
    '',
    `Заказ в БД: ${params.siteUrl}/cabinet (полная история — psql / OPERATIONS.md §5)`,
  ].join('\n')

  const html = `<p>Платёж успешно подтверждён CloudPayments.</p>
<ul>
  <li>Сумма: <strong>${amountFormatted} ₽</strong></li>
  <li>Invoice: <code>${escapeHtml(params.invoiceId)}</code></li>
  <li>E-mail клиента: ${escapeHtml(params.customerEmail)}</li>
  <li>${txLine}</li>
  <li>${methodLine}</li>
</ul>
<p style="color:#777;font-size:12px;">Полная история заказа — psql / <code>OPERATIONS.md §5</code>.</p>`

  return { subject, html, text }
}
