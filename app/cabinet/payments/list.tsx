'use client'

// teacher-payments-sbp-self-service debt clearance (2026-06-07).
// Список + cancel button для status='claimed'.

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button, Pill } from '@/components/ui/primitives'
import type { ClaimRow, ClaimStatus } from '@/lib/payments/sbp-claims'
import type { RefundRow } from '@/lib/payments/sbp-refunds'

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

function pillFor(status: ClaimStatus) {
  switch (status) {
    case 'claimed':
      return { label: 'Ждёт подтверждения', tone: 'warning' as const }
    case 'confirmed':
      return { label: 'Подтверждено', tone: 'success' as const }
    case 'declined':
      return { label: 'Не подтверждено', tone: 'danger' as const }
    case 'cancelled':
      return { label: 'Отменено', tone: 'default' as const }
  }
}

function refundReasonLabel(reason: RefundRow['reason']): string {
  switch (reason) {
    case 'slot_cancelled':
      return 'Занятие отменилось'
    case 'overpaid':
      return 'Переплата'
    case 'goodwill':
      return 'Возврат по доброй воле'
    case 'duplicate':
      return 'Дублирующий перевод'
    case 'other':
      return 'Другое'
  }
}

export function LearnerPaymentsList({
  initial,
  initialRefunds = [],
}: {
  initial: ClaimRow[]
  initialRefunds?: RefundRow[]
}) {
  const router = useRouter()
  const [claims, setClaims] = useState(initial)
  const [refunds, setRefunds] = useState(initialRefunds)
  useEffect(() => {
    setClaims(initial)
  }, [initial])
  useEffect(() => {
    setRefunds(initialRefunds)
  }, [initialRefunds])
  const refundsByClaim = refunds.reduce<Record<string, RefundRow[]>>(
    (acc, r) => {
      const list = acc[r.claimId] ?? []
      list.push(r)
      acc[r.claimId] = list
      return acc
    },
    {},
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function cancelClaim(id: string) {
    if (!confirm('Отменить заявку? Если вы её заявили по ошибке, пометка исчезнет.')) {
      return
    }
    setBusyId(id)
    setErr(null)
    try {
      const r = await fetch(`/api/learner/payment-claims/${id}/cancel`, {
        method: 'POST',
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${r.status}`)
        return
      }
      setClaims((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: 'cancelled' as ClaimStatus } : c,
        ),
      )
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  if (claims.length === 0) {
    return (
      <div
        className="card"
        style={{
          padding: 24,
          color: 'var(--secondary)',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        Пока пусто. Когда вы оплатите занятие через кнопку «Оплатить»
        в карточке занятия, история появится здесь.
      </div>
    )
  }

  return (
    <>
      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {err}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {claims.map((c) => {
          const pill = pillFor(c.status)
          return (
            <li key={c.id} className="card" style={{ padding: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    Учитель {c.teacherName}
                  </div>
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    Заявлено {formatDate(c.claimedAt)} ·{' '}
                    {c.paymentChannel === 'sbp' ? 'СБП' : 'Другой способ'}
                  </div>
                  {c.items.length > 0 ? (
                    <div
                      style={{
                        color: 'var(--secondary)',
                        fontSize: 13,
                        marginTop: 8,
                      }}
                    >
                      За: {c.items.map((it) => it.label).join('; ')}
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
                      Учитель: {c.noteTeacher}
                    </div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      marginBottom: 4,
                    }}
                  >
                    {formatRub(c.amountKopecks)}
                  </div>
                  <Pill tone={pill.tone} size="sm">
                    {pill.label}
                  </Pill>
                </div>
              </div>
              {refundsByClaim[c.id]?.length ? (
                <ul
                  style={{
                    listStyle: 'none',
                    margin: '12px 0 0',
                    padding: '12px 0 0',
                    borderTop: '1px solid var(--border)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  {refundsByClaim[c.id].map((r) => (
                    <li
                      key={r.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 13,
                        color: 'var(--secondary)',
                      }}
                    >
                      <span>
                        Возврат {formatDate(r.refundedAt)} ·{' '}
                        {refundReasonLabel(r.reason)}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                      <strong style={{ color: 'var(--foreground)' }}>
                        −{formatRub(r.amountKopecks)}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.status === 'claimed' ? (
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelClaim(c.id)}
                    disabled={busyId === c.id}
                  >
                    {busyId === c.id ? 'Отменяем…' : 'Отменить заявку'}
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
