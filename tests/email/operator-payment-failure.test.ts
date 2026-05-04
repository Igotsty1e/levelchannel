import { describe, expect, it } from 'vitest'

import { renderOperatorPaymentFailureEmail } from '@/lib/email/templates/operator-payment-failure'

describe('renderOperatorPaymentFailureEmail', () => {
  it('formats subject with «НЕ прошёл» + amount + invoice', () => {
    const t = renderOperatorPaymentFailureEmail({
      invoiceId: 'lc_failed',
      amountRub: 1500,
      customerEmail: 'a@b.com',
      source: 'CloudPayments Fail webhook',
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.subject).toContain('НЕ прошёл')
    expect(t.subject).toContain('lc_failed')
    expect(t.subject).toMatch(/1.?500/)
  })

  it('renders source + reason fields in body', () => {
    const t = renderOperatorPaymentFailureEmail({
      invoiceId: 'lc_x',
      amountRub: 100,
      customerEmail: 'x@y.com',
      source: '3DS callback decline',
      reason: 'Insufficient funds',
      reasonCode: 5051,
      transactionId: 1234567,
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.text).toContain('3DS callback decline')
    expect(t.text).toContain('Причина: Insufficient funds')
    expect(t.text).toContain('Код причины: 5051')
    expect(t.text).toContain('Transaction id: 1234567')
  })

  it('falls back to em-dash on missing optional fields', () => {
    const t = renderOperatorPaymentFailureEmail({
      invoiceId: 'lc_min',
      amountRub: 100,
      customerEmail: 'x@y.com',
      source: 'CloudPayments Fail webhook',
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.text).toContain('Причина: —')
    expect(t.text).toContain('Код причины: —')
    expect(t.text).toContain('Transaction id: —')
  })

  it('escapes html in customer-supplied + cloudpayments-supplied fields', () => {
    const t = renderOperatorPaymentFailureEmail({
      invoiceId: 'lc_safe',
      amountRub: 1,
      customerEmail: 'evil<script>@example.com',
      source: '<style>x</style>',
      reason: '<svg/onload=alert(1)>',
      transactionId: '<img src=x>',
      siteUrl: 'https://levelchannel.ru',
    })
    expect(t.html).not.toContain('<script>')
    expect(t.html).not.toContain('<svg')
    expect(t.html).not.toContain('<style>')
    expect(t.html).toContain('&lt;script&gt;')
  })

  it('includes customer comment when present', () => {
    const t = renderOperatorPaymentFailureEmail({
      invoiceId: 'lc_cmt',
      amountRub: 1,
      customerEmail: 'x@y.com',
      source: 'fail',
      siteUrl: 'https://levelchannel.ru',
      customerComment: 'за урок 5 мая',
    })
    expect(t.text).toContain('Комментарий клиента: за урок 5 мая')
    expect(t.html).toContain('за урок 5 мая')
  })
})
