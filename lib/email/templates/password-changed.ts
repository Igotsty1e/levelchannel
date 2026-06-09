import { escapeHtml } from '@/lib/email/escape'

/**
 * In-cabinet password change confirmation.
 *
 * Sent as a fire-and-forget security-notification AFTER a successful
 * `POST /api/account/password/change`. Recipient = the account's
 * verified e-mail. Goal: detect compromise — if user receives this
 * but didn't change the password, they should follow the reset flow.
 */
export function renderPasswordChangedEmail(params: {
  ipPrefix: string | null
  uaSummary: string | null
  changedAtIso: string
  forgotUrl: string
}) {
  const { ipPrefix, uaSummary, changedAtIso, forgotUrl } = params
  const safeIp = escapeHtml(ipPrefix ?? 'неизвестно')
  const safeUa = escapeHtml(uaSummary ?? 'неизвестно')
  const safeWhen = escapeHtml(
    new Date(changedAtIso).toLocaleString('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Moscow',
    }),
  )
  const safeForgot = escapeHtml(forgotUrl)

  const subject = 'Пароль в LevelChannel был изменён'

  const text = [
    'Здравствуйте.',
    '',
    `Только что был изменён пароль вашего кабинета LevelChannel:`,
    `Время: ${safeWhen} (Москва)`,
    `IP-сеть: ${safeIp}`,
    `Устройство: ${safeUa}`,
    '',
    'Если это были не вы — пароль уже изменён, но текущая сессия может',
    'оставаться у злоумышленника. Сразу сбросьте пароль на странице:',
    forgotUrl,
    '',
    'Если это были вы — никаких действий не нужно.',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;">Пароль в LevelChannel был изменён</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    Только что был изменён пароль вашего кабинета.
  </p>
  <table cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:8px;margin:0 0 18px;font-size:14px;width:100%;">
    <tr><td style="padding:10px 14px;color:#5F5F67;border-bottom:1px solid #f0f0f0;">Время</td><td style="padding:10px 14px;">${safeWhen} (Москва)</td></tr>
    <tr><td style="padding:10px 14px;color:#5F5F67;border-bottom:1px solid #f0f0f0;">IP-сеть</td><td style="padding:10px 14px;">${safeIp}</td></tr>
    <tr><td style="padding:10px 14px;color:#5F5F67;">Устройство</td><td style="padding:10px 14px;">${safeUa}</td></tr>
  </table>
  <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
    Если это были не вы — пароль уже изменён, но активная сессия может оставаться у злоумышленника. Сбросьте пароль ещё раз:
  </p>
  <p style="margin:0 0 16px;">
    <a href="${safeForgot}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#C87878;color:#fff;text-decoration:none;font-weight:600;">
      Сбросить пароль
    </a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0;">
    Если это были вы — никаких действий не нужно.
  </p>
</div>
`.trim()

  return { subject, text, html }
}
