export function renderResetEmail(params: { resetUrl: string }) {
  const { resetUrl } = params

  const subject = 'Сброс пароля в LevelChannel'

  const text = [
    'Здравствуйте.',
    '',
    'Вы запросили сброс пароля для кабинета LevelChannel. Чтобы задать',
    'новый пароль, откройте ссылку:',
    '',
    resetUrl,
    '',
    'Ссылка действительна 1 час. Если вы не запрашивали сброс,',
    'просто проигнорируйте это письмо — ваш текущий пароль останется без изменений.',
  ].join('\n')

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0B0B0C;">
  <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;">Сброс пароля в LevelChannel</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
    Вы запросили сброс пароля. Чтобы задать новый пароль, откройте ссылку:
  </p>
  <p style="margin:0 0 16px;">
    <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#C87878;color:#fff;text-decoration:none;font-weight:600;">
      Задать новый пароль
    </a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0 0 16px;">
    Если кнопка не открывается, скопируйте ссылку:<br/>
    <span style="word-break:break-all;">${resetUrl}</span>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5F5F67;margin:0;">
    Ссылка действительна 1 час. Если вы не запрашивали сброс, просто проигнорируйте это письмо.
  </p>
</div>
`.trim()

  return { subject, text, html }
}
