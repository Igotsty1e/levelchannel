import { describe, expect, it } from 'vitest'

import { escapeHtml } from '@/lib/email/escape'

describe('lib/email/escape', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;')
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('>')).toBe('&gt;')
    expect(escapeHtml('"')).toBe('&quot;')
    expect(escapeHtml("'")).toBe('&#39;')
  })

  it('escapes inside a longer string and preserves order', () => {
    expect(escapeHtml('Tom & Jerry "<>"')).toBe('Tom &amp; Jerry &quot;&lt;&gt;&quot;')
  })

  it('returns identical string when nothing dangerous', () => {
    expect(escapeHtml('https://levelchannel.ru/verify?token=abcXYZ_-')).toBe(
      'https://levelchannel.ru/verify?token=abcXYZ_-',
    )
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('escapes only on the dangerous chars, not on percents or path slashes', () => {
    // base64url token that survived encodeURIComponent already; should pass through
    expect(escapeHtml('a/b%20c')).toBe('a/b%20c')
  })
})
