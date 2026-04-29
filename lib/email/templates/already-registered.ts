import { escapeHtml } from '@/lib/email/escape'

// Sent to an existing-account email path on POST /api/auth/register
// (per /plan-eng-review D1 — symmetric work between new-email and
// already-registered paths). Same Resend SDK call, same wall-clock as
// the verify email — closes the timing-side-channel email enumeration
// vector that would otherwise let an attacker measure response latency
// and learn whether an email is registered.
//
// Content tone: helpful, not paranoid. The recipient might genuinely
// have forgotten they registered. Pointers to login + reset are cheap.

export function renderAlreadyRegisteredEmail(params: {
  loginUrl: string
  resetUrl: string
}) {
  const { loginUrl, resetUrl } = params
  const safeLoginUrl = escapeHtml(loginUrl)
  const safeResetUrl = escapeHtml(resetUrl)

  const subject = 'Попытка регистрации в LevelChannel'

  const text = [
    'Здравствуйте.',
    '',
    'Кто-то (возможно, вы) попытался зарегистрироваться в LevelChannel',
    'с этим e-mail, но у нас уже есть аккаунт с таким адресом.',
    '',
    'Если это были вы:',
    `- Войти: ${loginUrl}`,
    `- Сбросить пароль: ${resetUrl}`,
    '',
    'Если это не вы, ничего делать не нужно — никто не получил доступ к',
    'вашему аккаунту, потому что мы не позволяем регистрировать второй',
    'аккаунт на тот же e-mail.',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;">Попытка регистрации в LevelChannel</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    Кто-то (возможно, вы) попытался зарегистрироваться в LevelChannel с этим e-mail. У нас уже есть аккаунт с таким адресом.
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    Если это были вы:
  </p>
  <p style="margin:0 0 12px;">
    <a href="${safeLoginUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#C87878;color:#fff;text-decoration:none;font-weight:600;">
      Войти
    </a>
    &nbsp;
    <a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:transparent;color:#C87878;border:1px solid #C87878;text-decoration:none;font-weight:600;">
      Сбросить пароль
    </a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:16px 0 0;">
    Если это не вы, ничего делать не нужно — никто не получил доступ к вашему аккаунту, потому что мы не позволяем регистрировать второй аккаунт на тот же e-mail.
  </p>
</div>
`.trim()

  return { subject, text, html }
}
