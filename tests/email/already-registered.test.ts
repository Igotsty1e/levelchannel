import { describe, expect, it } from 'vitest'

import { renderAlreadyRegisteredEmail } from '@/lib/email/templates/already-registered'

describe('lib/email/templates/already-registered', () => {
  const params = {
    loginUrl: 'https://levelchannel.ru/login',
    resetUrl: 'https://levelchannel.ru/forgot',
  }

  it('renders subject in Russian', () => {
    const tpl = renderAlreadyRegisteredEmail(params)
    expect(tpl.subject).toMatch(/Попытка регистрации/)
  })

  it('text body contains both login and reset URLs', () => {
    const tpl = renderAlreadyRegisteredEmail(params)
    expect(tpl.text).toContain(params.loginUrl)
    expect(tpl.text).toContain(params.resetUrl)
  })

  it('html body escapes URLs through escapeHtml', () => {
    const tpl = renderAlreadyRegisteredEmail({
      loginUrl: 'https://levelchannel.ru/login?x=<script>',
      resetUrl: 'https://levelchannel.ru/forgot?y="malicious"',
    })
    expect(tpl.html).not.toContain('<script>')
    expect(tpl.html).not.toContain('"malicious"')
    expect(tpl.html).toContain('&lt;script&gt;')
    expect(tpl.html).toContain('&quot;malicious&quot;')
  })

  it('html body does not contain raw user-controlled brackets', () => {
    const tpl = renderAlreadyRegisteredEmail({
      loginUrl: 'https://example.com/<a>',
      resetUrl: 'https://example.com/<b>',
    })
    // Each <a> and <b> from URLs must be escaped; the template's own <a> tags stay
    const escapedFromUrls = tpl.html.match(/&lt;[ab]&gt;/g) || []
    expect(escapedFromUrls.length).toBe(2)
  })
})
