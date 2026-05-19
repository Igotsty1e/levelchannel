import { escapeHtml } from '@/lib/email/escape'

// Wave 15 — operator-facing notification on a permanent
// package-grant failure (`payment.grant.failed` audit event).
//
// Fires on every enumerated semantic-failure reason from
// lib/billing/package-grant.ts (eight as of PKG-ADMIN-GRANT
// 2026-05-16, last added: already_owns_active_package — a learner
// paid but a duplicate active package already exists from a
// concurrent admin grant; operator must refund). Webhook retries
// for the SAME invoice take the idempotent-replay path and emit a
// success audit row, not this email.
//
// Why per-event email AND not just rely on the audit log: a paid
// order whose grant fails leaves the customer paying without a
// package. The 30-min aggregate alert won't help the first
// affected customer; an immediate operator email gets human eyes
// on the pile-up before a support ticket lands.

export type OperatorPackageGrantFailureParams = {
  invoiceId: string
  packageSlug: string | null
  customerEmail: string | null
  amountRub: number | null
  reason: string
  // Server-derived hint for the operator: "ID account из metadata
  // не существует", "email не сматчился ни с одним аккаунтом", etc.
  reasonHint?: string
  siteUrl: string
}

export function renderOperatorPackageGrantFailureEmail(
  params: OperatorPackageGrantFailureParams,
): { subject: string; html: string; text: string } {
  const amount =
    params.amountRub != null
      ? new Intl.NumberFormat('ru-RU', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(params.amountRub) + ' ₽'
      : '—'

  const subject = `[LevelChannel] Пакет НЕ выдан: invoice ${params.invoiceId} (${params.reason})`

  const lines = [
    `Платёж прошёл, но пакет не материализован.`,
    `Клиент уже оплатил, package_purchases пустой — это требует ручного разбора.`,
    '',
    `Reason: ${params.reason}`,
    ...(params.reasonHint ? [`Detail: ${params.reasonHint}`] : []),
    `Invoice: ${params.invoiceId}`,
    `Package slug: ${params.packageSlug || '—'}`,
    `Customer email: ${params.customerEmail || '—'}`,
    `Сумма: ${amount}`,
    '',
    `Действие: открыть /admin/payments/${params.invoiceId}, найти причину расхождения`,
    `(metadata.accountId не сматчился, email rotated, и т.п.) и либо вручную`,
    `выдать пакет (UPDATE), либо вернуть деньги.`,
    '',
    `Сайт: ${params.siteUrl}`,
  ].join('\n')

  const html = `<p><strong>Платёж прошёл, но пакет не выдан.</strong></p>
<p style="color:#a33;">Клиент уже оплатил, <code>package_purchases</code> пустой — требуется ручной разбор.</p>
<ul>
  <li>Reason: <code>${escapeHtml(params.reason)}</code></li>
  ${params.reasonHint ? `<li>Detail: ${escapeHtml(params.reasonHint)}</li>` : ''}
  <li>Invoice: <code>${escapeHtml(params.invoiceId)}</code></li>
  <li>Package slug: <code>${escapeHtml(params.packageSlug || '—')}</code></li>
  <li>Customer email: ${escapeHtml(params.customerEmail || '—')}</li>
  <li>Сумма: <strong>${amount}</strong></li>
</ul>
<p>Открыть <code>/admin/payments/${escapeHtml(params.invoiceId)}</code> и разобрать причину расхождения.</p>
<p style="color:#777;font-size:12px;">Сайт: ${escapeHtml(params.siteUrl)}</p>`

  return { subject, html, text: lines }
}
