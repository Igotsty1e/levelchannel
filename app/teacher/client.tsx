'use client'

import { useState } from 'react'

import { PaintConfirmModal } from '@/components/calendar/PaintConfirmModal'
import { SlotCalendar } from '@/components/calendar/SlotCalendar'
import type { PaintSpan, MoveTarget } from '@/lib/calendar/drag-state'
import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave C — teacher self-create surface. Mounts <SlotCalendar /> with
// drag interactions wired to /api/teacher/slots/* endpoints. Click on
// an existing slot opens TeacherSlotDetailModal which can cancel
// (open: optional reason; booked: required reason). Drag empty cells
// → PaintConfirmModal → bulk-create. Drag own open slot → PATCH move.

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

export default function TeacherCalendarClient({
  teacherId,
  initialFromYmd,
  tariffs,
}: {
  teacherId: string
  initialFromYmd: string
  tariffs: ReadonlyArray<TariffOption>
}) {
  const [activeRow, setActiveRow] = useState<CalendarRow | null>(null)
  const [pendingPaint, setPendingPaint] = useState<PaintSpan | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 4000)
  }

  function bumpReload() {
    setReloadCounter((n) => n + 1)
  }

  async function handleMoveTarget(target: MoveTarget) {
    const newStartIso = halfHourToUtcIso(target.newYmd, target.newHalfHour)
    if (!newStartIso) {
      showToast('Не удалось вычислить новое время.')
      bumpReload()
      return
    }
    try {
      const res = await fetch(`/api/teacher/slots/${target.slotId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStartAt: newStartIso }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(
          `Перенос не удался: ${body.message || body.error || `HTTP ${res.status}`}`,
        )
      } else {
        showToast('Слот перенесён.')
      }
    } catch (err) {
      showToast(
        `Сеть недоступна: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      bumpReload()
    }
  }

  async function handlePaintConfirm({
    startsIso,
    durationMinutes,
    tariffId,
  }: {
    startsIso: ReadonlyArray<string>
    durationMinutes: number
    tariffId: string | null
  }) {
    let succeeded = false
    try {
      const res = await fetch('/api/teacher/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMinutes,
          tariffId,
          slots: startsIso.map((s) => ({ startAt: s })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      const skippedNote =
        data.skippedConflicts?.length > 0
          ? ` (пропущено как дубль: ${data.skippedConflicts.length})`
          : ''
      showToast(`Создано ${data.created.length} слотов${skippedNote}.`)
      succeeded = true
    } finally {
      bumpReload()
      if (succeeded) setPendingPaint(null)
    }
  }

  return (
    <div>
      {toast ? (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            background: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: 6,
            color: '#bfdbfe',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {toast}
        </div>
      ) : null}
      <SlotCalendar
        teacherId={teacherId}
        initialFromYmd={initialFromYmd}
        onSlotClick={(row) => setActiveRow(row)}
        interactions={{
          onPaintSpan: (span) => setPendingPaint(span),
          onMoveTarget: handleMoveTarget,
        }}
        refreshTrigger={reloadCounter}
      />

      {activeRow ? (
        <TeacherSlotDetailModal
          row={activeRow}
          onClose={() => setActiveRow(null)}
          onCancelled={() => {
            setActiveRow(null)
            showToast('Слот отменён.')
            bumpReload()
          }}
          onError={(msg) => showToast(`Ошибка: ${msg}`)}
        />
      ) : null}

      {pendingPaint ? (
        <PaintConfirmModal
          span={pendingPaint}
          tariffs={tariffs}
          onConfirm={handlePaintConfirm}
          onCancel={() => setPendingPaint(null)}
        />
      ) : null}
    </div>
  )
}

function TeacherSlotDetailModal({
  row,
  onClose,
  onCancelled,
  onError,
}: {
  row: CalendarRow
  onClose: () => void
  onCancelled: () => void
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const slot = row.slot
  // Teacher can cancel both `open` (no reason needed) and
  // `booked-full` (their booked-by-other view = it's booked by a
  // learner; reason required). past-* and cancelled = no action.
  const canCancel = slot.kind === 'open' || slot.kind === 'booked-full'
  const reasonRequired = slot.kind === 'booked-full'
  const slotId = 'id' in slot ? slot.id : null

  async function handleCancel() {
    if (!slotId) return
    if (reasonRequired && reason.trim() === '') {
      setLocalError(
        'Чтобы отменить занятие ученика, укажите причину для аудита.',
      )
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const res = await fetch(`/api/teacher/slots/${slotId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.error === 'reason_required_for_booked') {
          setLocalError(
            'Чтобы отменить занятие ученика, укажите причину для аудита.',
          )
          return
        }
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      onCancelled()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-slot-title"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f1f23',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          color: '#e4e4e7',
        }}
      >
        <h2 id="teacher-slot-title" style={{ fontSize: 18, marginBottom: 12 }}>
          Слот {row.startLabel} – {row.endLabel}{' '}
          <span style={{ fontSize: 12, color: '#71717a', fontWeight: 400 }}>
            (МСК)
          </span>
        </h2>
        <dl style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          <Row label="Дата" value={row.dayYmd} />
          <Row label="Длительность" value={`${slot.durationMinutes} мин`} />
          <Row label="Статус" value={statusLabel(slot.kind)} />
          {'learnerEmail' in slot && slot.learnerEmail ? (
            <Row label="Ученик" value={slot.learnerEmail} />
          ) : null}
          {'tariffAmountKopecks' in slot &&
          slot.tariffAmountKopecks !== null &&
          slot.tariffAmountKopecks !== undefined ? (
            <Row
              label="Тариф"
              value={`${(slot.tariffAmountKopecks / 100).toLocaleString('ru-RU')} ₽`}
            />
          ) : null}
        </dl>

        {canCancel ? (
          <div style={{ marginTop: 20 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                color: '#9ca3af',
                marginBottom: 6,
              }}
            >
              {reasonRequired
                ? 'Причина отмены (обязательно для ученика):'
                : 'Причина отмены (необязательно):'}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${
                  reasonRequired && reason.trim() === '' && localError
                    ? 'rgba(239, 68, 68, 0.5)'
                    : 'rgba(255,255,255,0.1)'
                }`,
                borderRadius: 6,
                color: '#e4e4e7',
                fontSize: 13,
              }}
              placeholder={
                reasonRequired
                  ? 'Например: заболел, смог только перенести'
                  : 'Например: освобождаю слот'
              }
            />
          </div>
        ) : null}

        {localError ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#fecaca',
              fontSize: 13,
            }}
          >
            {localError}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={btnSecondary}
          >
            Закрыть
          </button>
          {canCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              style={btnDanger}
            >
              {busy ? 'Отменяем…' : 'Отменить слот'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ minWidth: 100, color: '#71717a' }}>{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Свободен'
    case 'booked-self':
      return 'Забронирован вами'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронирован'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедший'
  }
}

function halfHourToUtcIso(ymd: string, halfHour: number): string | null {
  const totalMin = 6 * 60 + halfHour * 30
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const [, y, mo, d] = match
  const yi = Number(y)
  const moi = Number(mo)
  const di = Number(d)
  const utcMs = Date.UTC(yi, moi - 1, di, h - 3, m, 0)
  if (Number.isNaN(utcMs)) return null
  return new Date(utcMs).toISOString()
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  cursor: 'pointer',
  fontSize: 13,
}

const btnDanger: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid rgba(239, 68, 68, 0.5)',
  borderRadius: 6,
  color: '#fecaca',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
