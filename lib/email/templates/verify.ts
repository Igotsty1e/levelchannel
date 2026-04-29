// Plain inline HTML, no template engine. Anything fancier (React Email,
// MJML) is overkill for two transactional templates.

export function renderVerifyEmail(params: { verifyUrl: string }) {
  const { verifyUrl } = params

  const subject = 'Подтвердите e-mail для LevelChannel'

  const text = [
    'Здравствуйте.',
    '',
    'Вы регистрируетесь в кабинете LevelChannel. Чтобы подтвердить e-mail,',
    'откройте ссылку:',
    '',
    verifyUrl,
    '',
    'Ссылка действительна 24 часа. Если вы не запрашивали регистрацию,',
    'просто проигнорируйте это письмо.',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;">Подтвердите e-mail для LevelChannel</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    Вы регистрируетесь в кабинете LevelChannel. Чтобы подтвердить e-mail, откройте ссылку:
  </p>
  <p style="margin:0 0 16px;">
    <a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#C87878;color:#fff;text-decoration:none;font-weight:600;">
      Подтвердить e-mail
    </a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0 0 16px;">
    Если кнопка не открывается, скопируйте ссылку:<br/>
    <span style="word-break:break-all;">${verifyUrl}</span>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0;">
    Ссылка действительна 24 часа. Если вы не запрашивали регистрацию, просто проигнорируйте это письмо.
  </p>
</div>
`.trim()

  return { subject, text, html }
}
