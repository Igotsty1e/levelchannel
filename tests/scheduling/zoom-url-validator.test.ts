import { describe, expect, it } from 'vitest'

import { MAX_ZOOM_URL_LEN, validateZoomUrl } from '@/lib/scheduling/slots'

// BCS-DEF-3 (2026-05-18) — validateZoomUrl pure-function unit tests.

describe('validateZoomUrl', () => {
  it('accepts a clean https URL', () => {
    expect(validateZoomUrl('https://zoom.us/j/123456789')).toBeNull()
  })

  it('accepts an https URL with port + query + fragment', () => {
    expect(
      validateZoomUrl('https://meet.example.com:8443/room?pwd=abc#tab=2'),
    ).toBeNull()
  })

  it('rejects http://', () => {
    const r = validateZoomUrl('http://zoom.us/j/123')
    expect(r).not.toBeNull()
    expect(r?.reason).toBe('invalid_scheme')
  })

  it('rejects javascript: scheme', () => {
    const r = validateZoomUrl('javascript:alert(1)')
    expect(r).not.toBeNull()
    expect(r?.reason).toBe('invalid_scheme')
  })

  it('rejects data: scheme', () => {
    const r = validateZoomUrl('data:text/html,<script>x</script>')
    expect(r).not.toBeNull()
    expect(r?.reason).toBe('invalid_scheme')
  })

  it('rejects ftp://', () => {
    const r = validateZoomUrl('ftp://example.com')
    expect(r).not.toBeNull()
    expect(r?.reason).toBe('invalid_scheme')
  })

  it('rejects bare scheme (no host)', () => {
    const r = validateZoomUrl('https://')
    expect(r).not.toBeNull()
    expect(['invalid_url', 'invalid_scheme']).toContain(r?.reason)
  })

  it('rejects garbage that URL constructor refuses', () => {
    const r = validateZoomUrl('https://[not a url]')
    expect(r).not.toBeNull()
  })

  it('rejects exceeding max length', () => {
    const longSuffix = 'a'.repeat(MAX_ZOOM_URL_LEN)
    const longUrl = `https://example.com/${longSuffix}`
    const r = validateZoomUrl(longUrl)
    expect(r).not.toBeNull()
    expect(r?.reason).toBe('too_long')
  })

  it('accepts at exactly max length', () => {
    const prefix = 'https://example.com/'
    const padded = prefix + 'a'.repeat(MAX_ZOOM_URL_LEN - prefix.length)
    expect(padded.length).toBe(MAX_ZOOM_URL_LEN)
    expect(validateZoomUrl(padded)).toBeNull()
  })
})
