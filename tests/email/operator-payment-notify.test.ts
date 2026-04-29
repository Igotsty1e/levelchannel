import { describe, expect, it } from 'vitest'

import { renderOperatorPaymentNotifyEmail } from '@/lib/email/templates/operator-payment-notify'

describe('renderOperatorPaymentNotifyEmail', () => {
  it('formats amount with ru-RU separators', () => {
    const t = renderOperatorPaymentNotifyEmail({
      invoiceId: 'lc_xxx',
      amountRub: 12500,
      customerEmail: 'a@b.com',
      siteUrl: 'https://levelchannel.ru',
    })
    // Russian thousand separator is a non-breaking space, but Node's
    // ICU may output a regular space depending on environment. Match
    // either by stripping whitespace.
    const subjectStripped = t.subject.replace(/\s/g, '')
    expect(subjectStripped).toContain('Платёжполучен:12500₽—lc_xxx')
  })

  it('escapes html in customer-supplied fields', () => {
    const t = renderOperatorPaymentNotifyEmail({
      invoiceId: 'lc_safe',
      amountRub: 1,
      customerEmail: 'evil<script>@example.com',
      siteUrl: 'https://levelchannel.ru',
      transactionId: '<svg/onload=alert(1)>',
      paymentMethod: '<style>',
    })
    expect(t.html).not.toContain('<script>')
    expect(t.html).not.toContain('<svg')
    expect(t.html).not.toContain('<style>')
    // Escaped versions are present.
    expect(t.html).toContain('&lt;script&gt;')
    expect(t.html).toContain('&lt;svg/onload=alert(1)&gt;')
  })

  it('produces both html and plain-text bodies', () => {
    const t = renderOperatorPaymentNotifyEmail({
      invoiceId: 'lc_b',
      amountRub: 500,
      customerEmail: 'plain@example.com',
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.html).toContain('<ul>')
    expect(t.text).toMatch(/Сумма: 500 ₽/)
    expect(t.text).toContain('Invoice: lc_b')
    expect(t.text).toContain('plain@example.com')
  })

  it('handles missing transactionId and paymentMethod gracefully', () => {
    const t = renderOperatorPaymentNotifyEmail({
      invoiceId: 'lc_c',
      amountRub: 100,
      customerEmail: 'x@y.com',
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.text).toContain('Transaction id: —')
    expect(t.text).toContain('Способ: —')
  })
})
