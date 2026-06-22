'use client'

// teacher-payments-sbp-self-service Sub-PR D.
// Feed pending + history claims с actions «Подтвердить» / «Не пришло».

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { Button, ChipGroup, EmptyState, Pill } from '@/components/ui/primitives'
import { localizeTeacherError } from '@/lib/i18n/teacher-errors'
import type { ClaimRow, ClaimStatus } from '@/lib/payments/sbp-claims'
import type { RefundRow } from '@/lib/payments/sbp-refunds'
import { useFocusTrap } from '@/lib/util/focus-trap'

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
      return { label: 'Ждёт', tone: 'warning' }
    case 'confirmed':
      return { label: 'Подтверждено', tone: 'success' }
    case 'declined':
      return { label: 'Отклонено', tone: 'danger' }
    case 'cancelled':
      return { label: 'Отменено', tone: 'default' }
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
  // After router.refresh() Next.js re-renders this client component with
  // a new `initialClaims` prop but our local useState would otherwise
  // freeze the first snapshot. Resync the local state whenever the
  // server props change.
  useEffect(() => {
    setClaims(initialClaims)
  }, [initialClaims])
  useEffect(() => {
    setRefunds(initialRefunds)
  }, [initialRefunds])
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
  const declineDialogRef = useRef<HTMLDivElement | null>(null)
  const refundDialogRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(declineDialogRef, () => setDeclineTarget(null), declineTarget !== null)
  useFocusTrap(refundDialogRef, () => setRefundTarget(null), refundTarget !== null)

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
        setErr(
          localizeTeacherError(data?.error)
            ?? 'Не удалось подтвердить оплату. Попробуйте ещё раз.',
        )
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
        setErr(
          localizeTeacherError(data?.error)
            ?? 'Не удалось отклонить заявку. Попробуйте ещё раз.',
        )
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
        setErr(
          localizeTeacherError(data?.error)
            ?? 'Не удалось оформить возврат. Попробуйте ещё раз.',
        )
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
        role="tablist"
        aria-label="Заявки на оплату"
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
          role="tab"
          aria-selected={tab === 'pending'}
          onClick={() => setTab('pending')}
          style={tabBtnStyle(tab === 'pending')}
        >
          Ждут ({pending.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          style={tabBtnStyle(tab === 'history')}
        >
          История ({history.length})
        </button>
      </div>

      {err ? (
        <div
          role="alert"
          aria-live="polite"
          style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}
        >
          {err}
        </div>
      ) : null}

      {renderList.length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? 'Заявок пока нет' : 'История пуста'}
          body={
            tab === 'pending'
              ? 'Когда ученики отправят заявки «Я оплатил», они появятся здесь.'
              : 'Подтверждённые и отклонённые заявки будут показываться в этой вкладке.'
          }
        />
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
                      {formatDate(c.claimedAt)} ·{' '}
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
        <DeclineModal
          target={declineTarget}
          note={declineNote}
          setNote={setDeclineNote}
          onCancel={() => setDeclineTarget(null)}
          onSubmit={submitDecline}
          busy={busyId === declineTarget.id}
          dialogRef={declineDialogRef}
        />
      ) : null}

      {refundTarget ? (
        <RefundModal
          target={refundTarget}
          amountRub={refundAmountRub}
          setAmountRub={setRefundAmountRub}
          reason={refundReason}
          setReason={setRefundReason}
          note={refundNote}
          setNote={setRefundNote}
          onCancel={() => setRefundTarget(null)}
          onSubmit={submitRefund}
          busy={busyId === refundTarget.id}
          dialogRef={refundDialogRef}
        />
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

const labelInModalStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--secondary)',
  marginBottom: 6,
}

function DeclineModal({
  target,
  note,
  setNote,
  onCancel,
  onSubmit,
  busy,
  dialogRef,
}: {
  target: ClaimRow
  note: string
  setNote: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
  busy: boolean
  dialogRef: React.RefObject<HTMLDivElement>
}) {
  const titleId = useId()
  const descId = useId()
  const noteId = useId()
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={modalOverlay}
      onClick={onCancel}
    >
      <div ref={dialogRef} className="card" style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
          Не пришло
        </h2>
        <p id={descId} style={{ color: 'var(--secondary)', fontSize: 13, margin: 0, marginBottom: 16 }}>
          Заявка {target.learnerName} · {formatRub(target.amountKopecks)}.
          Комментарий увидит ученик.
        </p>
        <label htmlFor={noteId} style={labelInModalStyle}>
          Комментарий ученику (опционально)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="Например: проверьте назначение перевода"
          disabled={busy}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button variant="danger" onClick={onSubmit} disabled={busy}>
            Отклонить заявку
          </Button>
        </div>
      </div>
    </div>
  )
}

type RefundReasonValue = 'slot_cancelled' | 'overpaid' | 'goodwill' | 'duplicate' | 'other'

function RefundModal({
  target,
  amountRub,
  setAmountRub,
  reason,
  setReason,
  note,
  setNote,
  onCancel,
  onSubmit,
  busy,
  dialogRef,
}: {
  target: ClaimRow
  amountRub: string
  setAmountRub: (v: string) => void
  reason: RefundReasonValue
  setReason: (v: RefundReasonValue) => void
  note: string
  setNote: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
  busy: boolean
  dialogRef: React.RefObject<HTMLDivElement>
}) {
  const titleId = useId()
  const descId = useId()
  const amountId = useId()
  const reasonId = useId()
  const noteId = useId()
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={modalOverlay}
      onClick={onCancel}
    >
      <div ref={dialogRef} className="card" style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 8 }}>
          Оформить возврат
        </h2>
        <p id={descId} style={{ color: 'var(--secondary)', fontSize: 13, margin: 0, marginBottom: 16 }}>
          Платформа только фиксирует факт — деньги вы возвращаете
          из своего банка вручную. Эта запись отразится у ученика
          в его истории.
        </p>
        <label htmlFor={amountId} style={labelInModalStyle}>
          Сумма (₽)
        </label>
        <input
          id={amountId}
          type="number"
          inputMode="decimal"
          min="1"
          value={amountRub}
          onChange={(e) => setAmountRub(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
        <label htmlFor={reasonId} style={{ ...labelInModalStyle, marginTop: 12 }}>
          Причина
        </label>
        <select
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value as RefundReasonValue)}
          disabled={busy}
          style={inputStyle}
        >
          <option value="slot_cancelled">Занятие отменилось</option>
          <option value="overpaid">Переплата</option>
          <option value="goodwill">Возврат по доброй воле</option>
          <option value="duplicate">Дублирующий перевод</option>
          <option value="other">Другое</option>
        </select>
        <label htmlFor={noteId} style={{ ...labelInModalStyle, marginTop: 12 }}>
          Комментарий (опционально)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          disabled={busy}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            Зафиксировать возврат
          </Button>
        </div>
      </div>
    </div>
  )
}
