'use client'

import { useState } from 'react'

import { postAuthJson } from '@/lib/auth/client'

type ResendState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export function ResendVerifyButton() {
  const [state, setState] = useState<ResendState>({ kind: 'idle' })

  if (state.kind === 'sent') {
    return (
      <span style={{ color: 'var(--text)', fontSize: 14 }}>
        Письмо отправлено. Проверьте почту (и спам).
      </span>
    )
  }

  async function onClick() {
    setState({ kind: 'pending' })
    const result = await postAuthJson('/api/auth/resend-verify', {})
    if (result.ok) {
      setState({ kind: 'sent' })
      return
    }
    setState({ kind: 'error', message: result.error })
  }

  return (
    <span>
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === 'pending'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--text)',
          textDecoration: 'underline',
          cursor: state.kind === 'pending' ? 'wait' : 'pointer',
          font: 'inherit',
        }}
      >
        {state.kind === 'pending' ? 'Отправляем…' : 'отправьте письмо повторно'}
      </button>
      {state.kind === 'error' ? (
        <span style={{ display: 'block', marginTop: 6, color: '#FFBABA', fontSize: 13 }}>
          {state.message}
        </span>
      ) : null}
    </span>
  )
}
