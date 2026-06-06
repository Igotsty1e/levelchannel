// BCS-DEF-4-PUSH (2026-06-06) — unit tests for the subscribe-route
// endpoint allowlist. Mirrors the contract documented in
// docs/plans/bcs-def-4-push-pwa-reminders.md §3.8.

import { describe, expect, it } from 'vitest'

import { isAllowedPushEndpoint } from '@/lib/notifications/push-provider-allowlist'

describe('isAllowedPushEndpoint', () => {
  it('accepts FCM endpoints', () => {
    expect(
      isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123XYZ'),
    ).toBe(true)
  })

  it('accepts Mozilla autopush endpoints', () => {
    expect(
      isAllowedPushEndpoint(
        'https://updates.push.services.mozilla.com/wpush/v2/AAAA',
      ),
    ).toBe(true)
  })

  it('accepts Safari/Apple endpoints', () => {
    expect(
      isAllowedPushEndpoint('https://web.push.apple.com/QABC'),
    ).toBe(true)
  })

  it('rejects http:// (must be https)', () => {
    expect(
      isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'),
    ).toBe(false)
  })

  it('rejects attacker subdomain that looks like googleapis', () => {
    expect(
      isAllowedPushEndpoint('https://attacker.googleapis.com/fcm/send/abc'),
    ).toBe(false)
  })

  it('rejects attacker subdomain that looks like mozilla', () => {
    expect(
      isAllowedPushEndpoint(
        'https://attacker.push.services.mozilla.com/wpush/v2/X',
      ),
    ).toBe(false)
  })

  it('rejects FCM URL with wrong path prefix', () => {
    expect(
      isAllowedPushEndpoint('https://fcm.googleapis.com/admin/abc'),
    ).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isAllowedPushEndpoint('not a url')).toBe(false)
    expect(isAllowedPushEndpoint('')).toBe(false)
  })

  it('rejects unrelated arbitrary https origin', () => {
    expect(isAllowedPushEndpoint('https://example.com/anything')).toBe(false)
  })
})
