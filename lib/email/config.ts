// Standalone config for the email transport. Lives in lib/email/ so a
// future move to a shared config module is a one-file refactor. We
// intentionally do not throw on a missing RESEND_API_KEY in dev — the
// transport falls back to a console writer so a developer can register
// without standing up Resend first.

export type EmailConfig = {
  apiKey: string
  from: string
  enabled: boolean
}

export function readEmailConfig(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim() || ''
  const from = process.env.EMAIL_FROM?.trim() || 'LevelChannel <onboarding@resend.dev>'
  return {
    apiKey,
    from,
    enabled: apiKey.length > 0,
  }
}
