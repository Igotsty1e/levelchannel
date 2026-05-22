'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// SAAS-PIVOT Epic 5A Day 5A — un-mark client button.
//
// Plan: docs/plans/saas-pivot-master.md §2.6.
//
// POSTs to /api/teacher/lessons/[id]/uncomplete. The route checks
// teacher ownership + 48h window + settlement/earnings gates and
// returns 409 on failure. We surface those reasons to the user.

export default function UncompleteButton({
  completionId,
}: {
  completionId: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/teacher/lessons/${completionId}/uncomplete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (res.ok) {
        router.refresh()
        return
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      setError(body.message || body.error || 'Не удалось снять отметку.')
    } catch (e) {
      setError((e as Error)?.message ?? 'Сетевая ошибка.')
    } finally {
      setPending(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          borderRadius: 4,
          cursor: pending ? 'wait' : 'pointer',
          fontSize: 13,
        }}
      >
        {pending ? '…' : 'Снять'}
      </button>
      {error && (
        <span style={{ color: 'var(--danger, #c0392b)', fontSize: 11 }}>
          {error}
        </span>
      )}
    </span>
  )
}
