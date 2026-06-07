'use client'

// teacher-payments-sbp-self-service Sub-PR D.
// Feed pending + history claims с actions «Подтвердить» / «Не пришло».

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, Pill } from '@/components/ui/primitives'
import type { ClaimRow, ClaimStatus } from '@/lib/payments/sbp-claims'

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusPill(status: ClaimStatus): { label: string; tone: 'success' | 'warning' | 'danger' | 'default' } {
  switch (status) {
    case 'claimed':
      return { label: 'Ждёт подтверждения', tone: 'warning' }
    case 'confirmed':
      return { label: 'Подтверждено', tone: 'success' }
    case 'declined':
      return { label: 'Отклонено', tone: 'danger' }
    case 'cancelled':
      return { label: 'Отменено учеником', tone: 'default' }
  }
}

export function ClaimsFeed({ initialClaims }: { initialClaims: ClaimRow[] }) {
  const router = useRouter()
  const [claims, setClaims] = useState(initialClaims)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'history'>('pending')

  async function confirm(claimId: string) {
    setBusyId(claimId)
    setErr(null)
    try {
      const r = await fetch(`/api/teacher/payment-claims/${claimId}/confirm`, {
        method: 'POST',
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${r.status}`)
        return
      }
      setClaims((prev) =>
        prev.map((c) =>
          c.id === claimId
            ? { ...c, status: 'confirmed' as ClaimStatus, resolvedAt: new Date().toISOString() }
            : c,
        ),
      )
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function decline(claimId: string) {
    const note = prompt('Причина (опционально):') ?? ''
    setBusyId(claimId)
    setErr(null)
    try {
      const r = await fetch(`/api/teacher/payment-claims/${claimId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${r.status}`)
        return
      }
      setClaims((prev) =>
        prev.map((c) =>
          c.id === claimId
            ? {
                ...c,
                status: 'declined' as ClaimStatus,
                resolvedAt: new Date().toISOString(),
                noteTeacher: note.trim() || c.noteTeacher,
              }
            : c,
        ),
      )
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const pending = claims.filter((c) => c.status === 'claimed')
  const history = claims.filter((c) => c.status !== 'claimed')

  const renderList = tab === 'pending' ? pending : history

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setTab('pending')}
          style={tabBtnStyle(tab === 'pending')}
        >
          Ждут ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          style={tabBtnStyle(tab === 'history')}
        >
          История ({history.length})
        </button>
      </div>

      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {err}
        </p>
      ) : null}

      {renderList.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 24,
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {tab === 'pending'
            ? 'Сейчас нет заявок, ожидающих вашего подтверждения.'
            : 'История пуста.'}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {renderList.map((c) => {
            const pill = statusPill(c.status)
            return (
              <li key={c.id} className="card" style={{ padding: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {c.learnerName}
                    </div>
                    <div
                      style={{
                        color: 'var(--secondary)',
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      Заявка {formatDate(c.claimedAt)} ·{' '}
                      {c.paymentChannel === 'sbp' ? 'СБП' : 'Другой способ'}
                      {c.paymentMethodPhone ? ` · ${c.paymentMethodPhone}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>
                      {formatRub(c.amountKopecks)}
                    </div>
                    <Pill tone={pill.tone} size="sm">
                      {pill.label}
                    </Pill>
                  </div>
                </div>
                {c.items.length > 0 ? (
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 13,
                      borderTop: '1px solid var(--border)',
                      paddingTop: 8,
                      marginTop: 8,
                    }}
                  >
                    За:{' '}
                    {c.items.map((it, i) => (
                      <span key={it.id}>
                        {i > 0 ? '; ' : ''}
                        {it.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {c.noteLearner ? (
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 13,
                      marginTop: 6,
                    }}
                  >
                    Комментарий ученика: {c.noteLearner}
                  </div>
                ) : null}
                {c.noteTeacher ? (
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 13,
                      marginTop: 6,
                    }}
                  >
                    Ваш комментарий: {c.noteTeacher}
                  </div>
                ) : null}
                {c.amountMismatchKopecks !== 0 ? (
                  <div
                    style={{
                      color: 'var(--warning)',
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    Расхождение с ожидаемой суммой:{' '}
                    {c.amountMismatchKopecks > 0 ? '+' : ''}
                    {formatRub(c.amountMismatchKopecks)}
                  </div>
                ) : null}
                {c.status === 'claimed' ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 12,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => decline(c.id)}
                      disabled={busyId === c.id}
                    >
                      Не пришло
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => confirm(c.id)}
                      disabled={busyId === c.id}
                    >
                      {busyId === c.id ? 'Сохраняем…' : 'Подтвердить'}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    color: active ? 'var(--text)' : 'var(--secondary)',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    padding: '4px 8px',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  }
}
