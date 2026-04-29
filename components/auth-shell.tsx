import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'

// Shared chrome for /register, /login, /forgot, /reset, /cabinet,
// /verify-pending, /verify-failed. Header sticky on top, content in a
// centered narrow column on dark background. Server component — auth-state
// rendering lives inside SiteHeader (client island).
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main
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
