import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'

// Shared chrome for /register, /login, /forgot, /reset, /cabinet,
// /verify-pending, /verify-failed. Header sticky on top, content in a
// centered narrow column on dark background. Server component — auth-state
// rendering lives inside SiteHeader (client island).
//
// SAAS-6-A11Y-1 (2026-05-19): skip-to-content link rendered as the
// first focusable element inside the shell — keyboard users press Tab
// once on a fresh page and jump straight past the header into
// <main id="main-content">. WCAG 2.4.1 (Bypass Blocks) Level A.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main-content" className="skip-to-content">
        Перейти к основному содержимому
      </a>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="auth-shell-main saas-chrome"
        style={{
          minHeight: 'calc(100vh - 56px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '64px 24px 96px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>{children}</div>
      </main>
    </>
  )
}
