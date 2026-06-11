'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AssignDirectModal } from '@/components/calendar/AssignDirectModal'
import { BulkAddSlotsModal } from '@/components/calendar/BulkAddSlotsModal'
import { MobileCreateFab, type CreateMode } from '@/components/calendar/MobileCreateFab'
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
  // teacher-direct-assign (2026-06-11): нужен для AssignDirectModal,
  // duration берётся из тарифа (нельзя редактировать в форме).
  durationMinutes?: number
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
  const router = useRouter()
  const [activeRow, setActiveRow] = useState<CalendarRow | null>(null)
  const [pendingPaint, setPendingPaint] = useState<PaintSpan | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [createMode, setCreateMode] = useState<CreateMode>('closed')

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
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
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
      <div
        className="calendar-bulk-add-desktop"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setCreateMode('assign')}
          style={{
            padding: '8px 14px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface-2)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + Назначить ученику
        </button>
        <button
          type="button"
          onClick={() => setCreateMode('bulk')}
          style={{
            padding: '8px 14px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + Добавить слоты
        </button>
      </div>
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
          onSuccess={(message) => {
            setActiveRow(null)
            showToast(message)
            bumpReload()
            // BCS-F.3 fix: also refresh the server component above the
            // calendar island so the SSR conflict banner picks up the
            // new state.
            router.refresh()
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

      <MobileCreateFab
        tariffs={tariffs}
        mode={createMode}
        onModeChange={setCreateMode}
        onCreated={() => {
          showToast('Занятие создано.')
          bumpReload()
          router.refresh()
        }}
      />
      <BulkAddSlotsModal
        open={createMode === 'bulk'}
        onClose={() => setCreateMode('closed')}
        onSwitchToSingle={() => setCreateMode('single')}
        onCreated={() => {
          showToast('Слоты созданы.')
          bumpReload()
          router.refresh()
        }}
        tariffs={tariffs}
      />
      <AssignDirectModal
        open={createMode === 'assign'}
        onClose={() => setCreateMode('closed')}
        onCreated={(info) => {
          showToast(
            info.emailSkipped
              ? 'Занятие назначено. Письмо не отправлено (anti-spam).'
              : 'Занятие назначено, ученик получит письмо.',
          )
          bumpReload()
          router.refresh()
        }}
        tariffs={tariffs}
      />
    </div>
  )
}

function TeacherSlotDetailModal({
  row,
  onClose,
  onSuccess,
  onError,
}: {
  row: CalendarRow
  onClose: () => void
  // BCS-F.3: split-by-kind success path. Caller passes the resolved
  // user-facing message so we don't display "Слот отменён" after a
  // dismiss/delete-external action that left the slot booked.
  onSuccess: (message: string) => void
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
  // Entity naming: open/free time = «слот», booked = «занятие».
  // Drives modal title + cancel button copy + cancel-reason label.
  const isFreeSlot = slot.kind === 'open'
  const entityWord = isFreeSlot ? 'слот' : 'занятие'
  const entityWordCap = isFreeSlot ? 'Слот' : 'Занятие'
  const slotId = 'id' in slot ? slot.id : null
  // BCS-F.3 — surface conflict resolution actions when this booked
  // slot has an external_conflict_at stamp. Plan §4.7 actions
  // (a) dismiss, (b) delete-external. Cancel = action (c) reuses the
  // existing flow above; move = (d) is intentionally not surfaced here
  // (booked slots aren't draggable in the calendar grid).
  const hasConflict =
    slot.kind === 'booked-full' &&
    'externalConflictAt' in slot &&
    slot.externalConflictAt !== null

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
      onSuccess('Слот отменён.')
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDismissConflict() {
    if (!slotId) return
    setBusy(true)
    setLocalError(null)
    try {
      const res = await fetch(
        `/api/teacher/slots/${slotId}/dismiss-conflict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      onSuccess(
        'Конфликт убран. Если событие в Google остаётся, метка вернётся.',
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteExternal() {
    if (!slotId) return
    setBusy(true)
    setLocalError(null)
    try {
      const res = await fetch(
        `/api/teacher/slots/${slotId}/delete-external-conflict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Map known server-side errors to user-safe Russian copy.
        if (body.error === 'source_not_writable') {
          setLocalError(body.message || 'Этот календарь только для чтения.')
          return
        }
        if (body.error === 'no_conflict_recorded') {
          setLocalError(
            'Конфликт уже был снят синхронизацией. Обновите страницу.',
          )
          return
        }
        if (body.error === 'token_unavailable') {
          setLocalError(
            'Не получилось обратиться к Google. Переподключите календарь в настройках.',
          )
          return
        }
        if (body.error === 'google_delete_failed') {
          setLocalError(
            'Google Calendar временно не подтвердил удаление. Попробуйте ещё раз через минуту.',
          )
          return
        }
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      onSuccess(
        body.deletedInGoogle === false
          ? 'Конфликт снят (событие уже было удалено в Google).'
          : 'Событие удалено в Google Calendar. Конфликт снят.',
      )
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
          background: 'var(--surface-1, #1f1f23)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          color: 'var(--text)',
        }}
      >
        <h2 id="teacher-slot-title" style={{ fontSize: 18, marginBottom: 12, marginTop: 0 }}>
          {entityWordCap} {row.startLabel} – {row.endLabel}{' '}
          <span style={{ fontSize: 12, color: 'var(--secondary)', fontWeight: 400 }}>
            · МСК
          </span>
        </h2>
        <dl style={{ fontSize: 13, color: 'var(--secondary)', lineHeight: 1.7, margin: 0 }}>
          <Row label="Дата" value={formatDayYmdRu(row.dayYmd)} />
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

        {hasConflict ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>⚠ Это занятие пересекается с событием в Google.</strong>{' '}
            Выберите ниже, что сделать.
          </div>
        ) : null}

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
                ? 'Что сказать ученику (обязательно):'
                : 'Заметка (необязательно):'}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--surface-2, rgba(255,255,255,0.05))',
                border: `1px solid ${
                  reasonRequired && reason.trim() === '' && localError
                    ? 'var(--danger)'
                    : 'var(--border)'
                }`,
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: 13,
              }}
              placeholder={
                reasonRequired
                  ? 'Например: заболел, перенесём на другой день'
                  : 'Например: для себя'
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
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              color: 'var(--text)',
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
          {hasConflict ? (
            <>
              <button
                type="button"
                onClick={handleDismissConflict}
                disabled={busy}
                style={btnSecondary}
                title="Уберите событие в Google вручную — метка вернётся, если оно всё ещё там"
              >
                {busy ? '…' : 'Уберу самостоятельно'}
              </button>
              <button
                type="button"
                onClick={handleDeleteExternal}
                disabled={busy}
                style={btnSecondary}
                title="Удалить событие в Google — работает только если LevelChannel подключён с правом записи"
              >
                {busy ? '…' : 'Удалить в Google'}
              </button>
            </>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              style={btnDanger}
            >
              {busy
                ? isFreeSlot
                  ? 'Удаляем…'
                  : 'Отменяем…'
                : isFreeSlot
                  ? 'Удалить слот'
                  : 'Отменить занятие'}
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
      <dt style={{ minWidth: 100, color: 'var(--secondary)' }}>{label}:</dt>
      <dd style={{ color: 'var(--text)', margin: 0 }}>{value}</dd>
    </div>
  )
}

function formatDayYmdRu(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const sameYear = new Date().getUTCFullYear() === Number(y)
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Свободно'
    case 'booked-self':
      return 'Ваше занятие'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Занято'
    case 'past-full':
    case 'past-redacted':
      return 'Прошло'
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
  background: 'var(--surface-2, rgba(255,255,255,0.05))',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
}

const btnDanger: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--danger-bg)',
  border: '1px solid var(--danger)',
  borderRadius: 6,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
