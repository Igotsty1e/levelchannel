// teacher-payments-sbp-self-service: email учителю при создании нового claim.

export type SbpClaimEmailParams = {
  teacherName: string
  learnerName: string
  amountRub: string
  itemsSummary: string
  paymentChannel: 'sbp' | 'other'
  cabinetUrl: string
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Strip CR/LF — prevents SMTP header injection via subject + plain-text
// body. Также убираем control chars и нормализуем whitespace до пробела.
function sanitizeHeader(s: string): string {
  return s.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').slice(0, 200)
}

export function renderSbpClaimEmail(p: SbpClaimEmailParams): {
  subject: string
  html: string
  text: string
} {
  const channelLabel = p.paymentChannel === 'sbp' ? 'СБП' : 'другим способом'
  // Sanitize all user-controlled inputs before interpolation into
  // subject/text. HTML body escapes via escape() below.
  const safeLearnerName = sanitizeHeader(p.learnerName)
  const safeTeacherName = sanitizeHeader(p.teacherName)
  const safeAmountRub = sanitizeHeader(p.amountRub)
  const safeItemsSummary = sanitizeHeader(p.itemsSummary)
  const subject = `Новая заявка на оплату от ${safeLearnerName}`
  const text = [
    `Здравствуйте, ${safeTeacherName}!`,
    '',
    `${safeLearnerName} заявил(а) оплату ${safeAmountRub} ${channelLabel}.`,
    `За: ${safeItemsSummary}.`,
    '',
    `Проверьте поступление и подтвердите заявку в кабинете:`,
    sanitizeHeader(p.cabinetUrl),
    '',
    'Если деньги не пришли — нажмите «Не пришло» в той же карточке заявки.',
  ].join('\n')

  const html = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0b0c;color:#e4e4e7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#18181b;border-radius:12px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
    <h1 style="margin:0 0 16px;font-size:22px;color:#fafafa;">Новая заявка на оплату</h1>
    <p style="margin:0 0 8px;color:#a1a1aa;font-size:14px;">Здравствуйте, ${escape(p.teacherName)}!</p>
    <p style="margin:0 0 16px;line-height:1.6;">
      <strong style="color:#fafafa;">${escape(p.learnerName)}</strong>
      заявил(а) оплату <strong style="color:#fafafa;">${escape(p.amountRub)}</strong> ${escape(channelLabel)}.
    </p>
    <p style="margin:0 0 16px;color:#a1a1aa;font-size:13px;">За: ${escape(p.itemsSummary)}.</p>
    <p style="margin:24px 0;">
      <a href="${escape(p.cabinetUrl)}"
         style="display:inline-block;padding:12px 24px;background:#D88A82;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
        Открыть заявки в кабинете
      </a>
    </p>
    <p style="margin:0;color:#71717a;font-size:12px;line-height:1.5;">
      Если деньги не пришли — нажмите «Не пришло» в той же карточке заявки.
      Платформа не держит ваши деньги: ученик переводит вам напрямую через СБП.
    </p>
  </div>
</body>
</html>`

  return { subject, html, text }
}
