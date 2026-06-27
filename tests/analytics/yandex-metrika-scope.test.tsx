// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  YandexMetrika,
  isPublicAnalyticsPath,
} from '@/components/analytics/YandexMetrika'

// Mock next/navigation usePathname so we can drive the scope gate.
let currentPath: string | null = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}))

// Mock next/script to a transparent <script> so we can assert nonce + presence
// (the Next runtime isn't available in jsdom; the contract we test is "an
// inline script with the per-request nonce is emitted on public pages only").
vi.mock('next/script', () => ({
  default: ({ children, nonce, id }: { children?: React.ReactNode; nonce?: string; id?: string }) => (
    <script data-testid={id} nonce={nonce}>
      {children}
    </script>
  ),
}))

afterEach(() => {
  currentPath = '/'
})

describe('isPublicAnalyticsPath', () => {
  it('allows public marketing surfaces', () => {
    for (const p of ['/', '/saas/learn', '/saas/learn/security', '/offer', '/saas/offer', '/privacy', '/consent', '/consent/personal-data', '/integrations/google-calendar']) {
      expect(isPublicAnalyticsPath(p)).toBe(true)
    }
  })

  it('blocks every authenticated / payment / PII surface', () => {
    for (const p of ['/login', '/register', '/auth/x', '/checkout/pro', '/pay', '/pay/123', '/cabinet', '/cabinet/lessons', '/teacher', '/teacher/settings', '/admin', '/admin/payments']) {
      expect(isPublicAnalyticsPath(p)).toBe(false)
    }
  })

  it('does not allow a private path that merely contains a public token', () => {
    // /cabinet/offer must NOT match the /offer prefix
    expect(isPublicAnalyticsPath('/cabinet/offer')).toBe(false)
    expect(isPublicAnalyticsPath(null)).toBe(false)
  })
})

describe('YandexMetrika component scope + nonce', () => {
  it('renders the nonced inline init script on a public page', () => {
    currentPath = '/'
    const { queryByTestId } = render(<YandexMetrika nonce="test-nonce-123" />)
    const el = queryByTestId('ym-init')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('nonce')).toBe('test-nonce-123')
    expect(el?.textContent).toContain('ym(')
  })

  it('renders nothing on an authenticated surface', () => {
    currentPath = '/cabinet/lessons'
    const { queryByTestId } = render(<YandexMetrika nonce="test-nonce-123" />)
    expect(queryByTestId('ym-init')).toBeNull()
  })

  it('renders nothing on the payment surface', () => {
    currentPath = '/checkout/pro'
    const { queryByTestId } = render(<YandexMetrika nonce="test-nonce-123" />)
    expect(queryByTestId('ym-init')).toBeNull()
  })
})
