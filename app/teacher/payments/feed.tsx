'use client'

// teacher-payments-sbp-self-service Sub-PR D.
// Feed pending + history claims с actions «Подтвердить» / «Не пришло».

import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

export function ClaimsFeed({
  initialClaims,
  initialRefunds = [],
}: {
  initialClaims: ClaimRow[]
  initialRefunds?: RefundRow[]
}) {
  const router = useRouter()
  const [claims, setClaims] = useState(initialClaims)
  const [refunds, setRefunds] = useState(initialRefunds)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [declineTarget, setDeclineTarget] = useState<ClaimRow | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [refundTarget, setRefundTarget] = useState<ClaimRow | null>(null)
  const [refundAmountRub, setRefundAmountRub] = useState('')
  const [refundReason, setRefundReason] = useState<
    'slot_cancelled' | 'overpaid' | 'goodwill' | 'duplicate' | 'other'
  >('slot_cancelled')
  const [refundNote, setRefundNote] = useState('')

  const refundsByClaim = refunds.reduce<Record<string, RefundRow[]>>(
    (acc, r) => {
      const list = acc[r.claimId] ?? []
      list.push(r)
      acc[r.claimId] = list
      return acc
    },
    {},
  )

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

  async function submitDecline() {
    if (!declineTarget) return
    const claimId = declineTarget.id
    const note = declineNote.trim()
    setBusyId(claimId)
    setErr(null)
    try {
      const r = await fetch(`/api/teacher/payment-claims/${claimId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || null }),
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
                noteTeacher: note || c.noteTeacher,
              }
            : c,
        ),
      )
      setDeclineTarget(null)
      setDeclineNote('')
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function submitRefund() {
    if (!refundTarget) return
    const amountKopecks = Math.round(Number(refundAmountRub) * 100)
    if (!Number.isFinite(amountKopecks) || amountKopecks <= 0) {
      setErr('Введите сумму больше 0.')
      return
    }
    setBusyId(refundTarget.id)
    setErr(null)
    try {
      const r = await fetch('/api/teacher/payment-refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimId: refundTarget.id,
          amountKopecks,
          reason: refundReason,
          note: refundNote.trim() || null,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        const map: Record<string, string> = {
          refund_exceeds_claim: 'Сумма возврата больше, чем была оплачена.',
          claim_not_confirmed: 'Можно возвращать только подтверждённые оплаты.',
        }
        setErr(map[data?.error] || data?.error || `HTTP ${r.status}`)
        return
      }
      const body = await r.json()
      const created: RefundRow = {
        id: body.refundId,
        claimId: refundTarget.id,
        amountKopecks,
        reason: refundReason,
        note: refundNote.trim() || null,
        refundedAt: new Date().toISOString(),
      }
      setRefunds((prev) => [created, ...prev])
      setRefundTarget(null)
      setRefundAmountRub('')
      setRefundNote('')
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
                {(refundsByClaim[c.id] ?? []).length > 0 ? (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: '1px solid var(--border)',
                      fontSize: 13,
                      color: 'var(--secondary)',
                    }}
                  >
                    {(refundsByClaim[c.id] ?? []).map((r) => (
                      <div key={r.id}>
                        Возврат: {formatRub(r.amountKopecks)}{' '}
                        ({REFUND_REASON_LABEL[r.reason]})
                        {r.note ? ` · ${r.note}` : ''}
                      </div>
                    ))}
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
                      onClick={() => {
                        setDeclineTarget(c)
                        setDeclineNote('')
                      }}
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
                {c.status === 'confirmed' ? (
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
                      onClick={() => {
                        setRefundTarget(c)
                        const remaining =
                          c.amountKopecks
                          - (refundsByClaim[c.id] ?? []).reduce(
                              (a, r) => a + r.amountKopecks,
                              0,
                            )
                        setRefundAmountRub(
                          String(Math.max(0, Math.round(remaining / 100))),
                        )
                        setRefundReason('slot_cancelled')
                        setRefundNote('')
                      }}
                      disabled={busyId === c.id}
                    >
                      Оформить возврат
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {declineTarget ? (
        <div role="dialog" aria-modal="true" style={modalOverlay} onClick={() => setDeclineTarget(null)}>
          <div className="card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
              Не пришло
            </h2>
            <p style={{ color: 'var(--secondary)', fontSize: 13, margin: 0, marginBottom: 16 }}>
              Заявка {declineTarget.learnerName} · {formatRub(declineTarget.amountKopecks)}
            </p>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Комментарий ученику (опционально)
            </label>
            <textarea
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Например: проверьте назначение перевода"
              disabled={busyId === declineTarget.id}
              style={textareaStyle}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setDeclineTarget(null)} disabled={busyId === declineTarget.id}>
                Отмена
              </Button>
              <Button variant="danger" onClick={submitDecline} disabled={busyId === declineTarget.id}>
                Отклонить заявку
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {refundTarget ? (
        <div role="dialog" aria-modal="true" style={modalOverlay} onClick={() => setRefundTarget(null)}>
          <div className="card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
              Оформить возврат
            </h2>
            <p style={{ color: 'var(--secondary)', fontSize: 13, margin: 0, marginBottom: 16 }}>
              Платформа только фиксирует факт — деньги вы возвращаете
              из своего банка вручную. Эта запись отразится у ученика
              в его истории.
            </p>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginBottom: 6,
              }}
            >
              Сумма (₽)
            </label>
            <input
              type="number"
              min="1"
              value={refundAmountRub}
              onChange={(e) => setRefundAmountRub(e.target.value)}
              disabled={busyId === refundTarget.id}
              style={inputStyle}
            />
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginTop: 12,
                marginBottom: 6,
              }}
            >
              Причина
            </label>
            <select
              value={refundReason}
              onChange={(e) =>
                setRefundReason(e.target.value as typeof refundReason)
              }
              disabled={busyId === refundTarget.id}
              style={inputStyle}
            >
              <option value="slot_cancelled">Занятие отменилось</option>
              <option value="overpaid">Переплата</option>
              <option value="goodwill">Возврат по доброй воле</option>
              <option value="duplicate">Дублирующий перевод</option>
              <option value="other">Другое</option>
            </select>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--secondary)',
                marginTop: 12,
                marginBottom: 6,
              }}
            >
              Комментарий (опционально)
            </label>
            <textarea
              value={refundNote}
              onChange={(e) => setRefundNote(e.target.value)}
              rows={2}
              maxLength={300}
              disabled={busyId === refundTarget.id}
              style={textareaStyle}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setRefundTarget(null)} disabled={busyId === refundTarget.id}>
                Отмена
              </Button>
              <Button onClick={submitRefund} disabled={busyId === refundTarget.id}>
                Зафиксировать возврат
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

const REFUND_REASON_LABEL: Record<string, string> = {
  slot_cancelled: 'занятие отменилось',
  overpaid: 'переплата',
  goodwill: 'добрая воля',
  duplicate: 'дубль',
  other: 'другое',
}

const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
}

const modalCard: React.CSSProperties = {
  padding: 24,
  minWidth: 320,
  maxWidth: 480,
  width: '100%',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
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
