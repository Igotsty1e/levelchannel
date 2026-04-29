import type { CSSProperties, ReactNode } from 'react'

// Shared visual primitives for the four auth forms. Kept tiny on purpose
// — these are CSS-prop styles, not a design system. If a fifth form needs
// something different, fork it; do not abstract further.

export const authInputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  color: 'var(--text)',
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
}

export function AuthField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint ? (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--secondary)' }}>{hint}</div>
      ) : null}
    </div>
  )
}

export function AuthErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(229, 80, 80, 0.08)',
        border: '1px solid rgba(229, 80, 80, 0.32)',
        borderRadius: 10,
        padding: '12px 14px',
        color: '#FFBABA',
        fontSize: 14,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}

export function AuthInfoBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        background: 'rgba(200, 120, 120, 0.06)',
        border: '1px solid rgba(200, 120, 120, 0.32)',
        borderRadius: 10,
        padding: '12px 14px',
        color: 'var(--text)',
        fontSize: 14,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}
