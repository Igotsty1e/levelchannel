'use client'

import { useRouter } from 'next/navigation'
import { CSSProperties, useEffect, useState } from 'react'

import { AssignDirectModal } from '@/components/calendar/AssignDirectModal'
import { BulkAddSlotsModal } from '@/components/calendar/BulkAddSlotsModal'
import { MobileCreateFab } from '@/components/calendar/MobileCreateFab'
import { PaintConfirmModal } from '@/components/calendar/PaintConfirmModal'
import { PersonalEventCreateModal } from '@/components/calendar/PersonalEventCreateModal'
import { PersonalEventDetailModal } from '@/components/calendar/PersonalEventDetailModal'
import { RescheduleByTeacherModal } from '@/components/calendar/RescheduleByTeacherModal'
import { SlotCalendar } from '@/components/calendar/SlotCalendar'
import type { PaintSpan, MoveTarget } from '@/lib/calendar/drag-state'
import type { CalendarRow } from '@/lib/calendar/view-model'

function pluralLessons(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'занятие'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия'
  return 'занятий'
}

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

// 2026-06-12 teacher-calendar-unify: убрана настройка slot_mode и
// sticky bottom FAB. Обе кнопки «Назначить ученику» + «Добавить слоты»
// живут в одном top-row.
//
// 2026-06-14 teacher-calendar-mouse-fix BUG-5 — визуальная разница
// primary vs secondary. «Назначить ученику» — частая операция, поэтому
// она выделена `--surface-3` фоном и `--accent` рамкой. «Добавить слоты»
// — реже, оставлена secondary на `--surface-2`. Без визуальной разводки
// одинаковые 13px кнопки на 8px gap были легко misclick'able.
function topActionBtnStyle(
  variant: 'primary' | 'secondary',
  disabled: boolean,
): CSSProperties {
  const isPrimary = variant === 'primary'
  return {
    padding: '8px 14px',
    border: `1px solid ${isPrimary ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 8,
    background: isPrimary ? 'var(--surface-3)' : 'var(--surface-2)',
    color: 'var(--text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  }
}

// 2026-06-14 teacher-calendar-mouse-fix BUG-2 — single state machine
// for every modal/sheet surface on /teacher/calendar. Replaces three
// independent useState flags (`activeRow`, `pendingPaint`, `createMode`)
// that had no mutual exclusion and could render 2-3 modals at the same
// time, exactly matching owner's «закрываешь — предлагает занятия
// назначить» report. Each modal mounts under its own `kind ===` gate;
// by construction, at most one is in the DOM at any moment.
type CalendarModalState =
  | { kind: 'closed' }
  | { kind: 'slot-detail'; row: CalendarRow }
  | { kind: 'teacher-reschedule'; row: CalendarRow } // Wave-B (2026-06-16)
  | { kind: 'paint-confirm'; span: PaintSpan }
  | { kind: 'single-create' }
  | { kind: 'bulk-create' }
  | { kind: 'assign-direct' }
  | { kind: 'personal-event-create' } // Epic B (2026-06-19)
  | { kind: 'personal-event-detail'; row: CalendarRow } // Epic B

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
  const [modal, setModal] = useState<CalendarModalState>({ kind: 'closed' })
  const [reloadCounter, setReloadCounter] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  // 2026-06-14 defensive — every modal-open transition bumps this so
  // the SlotCalendar wiring layer can clear a stale `painting` reducer
  // state + `pendingPaintRef` + `suppressClickRef`. Without this, a
  // race between drag-start and modal-open could leak a paint commit
  // after the modal closes. See plan-doc self-review WARN-1.
  const [dragResetSignal, setDragResetSignal] = useState(0)

  function openModal(next: CalendarModalState) {
    if (next.kind !== 'closed') {
      setDragResetSignal((n) => n + 1)
    }
    setModal(next)
  }
  function closeModal() {
    setModal({ kind: 'closed' })
  }

  const isModalOpen = modal.kind !== 'closed'

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
      if (succeeded) closeModal()
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
      {/* 2026-06-23 — CTAs теперь живут внутри Toolbar справа от
          range/nav/refresh single-row header. См. Toolbar `headerActions`
          prop. Раньше CTAs были в отдельной row выше SlotCalendar; owner
          request «давай сделаем все эти элементы в одну строку, а не
          в 2 как сейчас». Mobile per «Альтернатива A» — primary
          full-width, 2 secondary рядом. */}
      <SlotCalendar
        teacherId={teacherId}
        initialFromYmd={initialFromYmd}
        headerActions={
          <>
            <button
              type="button"
              onClick={() => openModal({ kind: 'assign-direct' })}
              disabled={isModalOpen}
              style={topActionBtnStyle('primary', isModalOpen)}
            >
              + Назначить ученику
            </button>
            <button
              type="button"
              onClick={() => openModal({ kind: 'bulk-create' })}
              disabled={isModalOpen}
              style={topActionBtnStyle('secondary', isModalOpen)}
            >
              + Добавить слоты
            </button>
            <button
              type="button"
              onClick={() => openModal({ kind: 'personal-event-create' })}
              disabled={isModalOpen}
              style={topActionBtnStyle('secondary', isModalOpen)}
              data-testid="calendar-add-personal-event-btn"
            >
              + Добавить дело
            </button>
          </>
        }
        // 2026-06-14 BUG-2 — drop slot click + paint commit while
        // any modal is open. The grid is visually behind the modal,
        // but rapid drag/click sequences could still race past the
        // backdrop. The state-machine gate makes the invariant
        // explicit instead of relying on z-index discipline.
        onSlotClick={(row) => {
          if (isModalOpen) return
          // Epic B (2026-06-19) — клик по делу → отдельная детальная
          // модалка с действиями «Выполнено / Отменить».
          if (row.slot.kind === 'personal-event') {
            openModal({ kind: 'personal-event-detail', row })
            return
          }
          openModal({ kind: 'slot-detail', row })
        }}
        interactions={{
          onPaintSpan: (span) => {
            if (isModalOpen) return
            openModal({ kind: 'paint-confirm', span })
          },
          onMoveTarget: handleMoveTarget,
        }}
        refreshTrigger={reloadCounter}
        dragResetSignal={dragResetSignal}
      />

      {modal.kind === 'slot-detail' ? (
        <TeacherSlotDetailModal
          row={modal.row}
          onClose={closeModal}
          onSuccess={(message) => {
            closeModal()
            showToast(message)
            bumpReload()
            // BCS-F.3 fix: also refresh the server component above the
            // calendar island so the SSR conflict banner picks up the
            // new state.
            router.refresh()
          }}
          onError={(msg) => showToast(`Ошибка: ${msg}`)}
          onRequestReschedule={(row) =>
            openModal({ kind: 'teacher-reschedule', row })
          }
        />
      ) : null}

      {modal.kind === 'teacher-reschedule' ? (
        <RescheduleByTeacherModal
          row={modal.row}
          onClose={closeModal}
          onSuccess={(message) => {
            closeModal()
            showToast(message)
            bumpReload()
            router.refresh()
          }}
        />
      ) : null}

      {modal.kind === 'paint-confirm' ? (
        <PaintConfirmModal
          span={modal.span}
          tariffs={tariffs}
          onConfirm={handlePaintConfirm}
          onCancel={closeModal}
        />
      ) : null}

      {modal.kind === 'single-create' ? (
        <MobileCreateFab
          tariffs={tariffs}
          mode="single"
          onModeChange={(next) => {
            if (next === 'closed') closeModal()
            else if (next === 'bulk') openModal({ kind: 'bulk-create' })
            else if (next === 'assign') openModal({ kind: 'assign-direct' })
            // 'single' is no-op — we're already there
          }}
          onCreated={() => {
            showToast('Занятие создано.')
            bumpReload()
            router.refresh()
          }}
        />
      ) : null}

      {modal.kind === 'bulk-create' ? (
        <BulkAddSlotsModal
          open
          onClose={closeModal}
          onSwitchToSingle={() => openModal({ kind: 'single-create' })}
          onCreated={() => {
            showToast('Слоты созданы.')
            bumpReload()
            router.refresh()
          }}
          tariffs={tariffs}
        />
      ) : null}

      {modal.kind === 'assign-direct' ? (
        <AssignDirectModal
          open
          onClose={closeModal}
          onCreated={(info) => {
            showToast(
              info.emailSkipped
                ? 'Занятие назначено. Письмо не отправлено (anti-spam).'
                : 'Занятие назначено, ученик получит письмо.',
            )
            bumpReload()
            router.refresh()
          }}
          onCreatedSeries={(info) => {
            const word = pluralLessons(info.createdCount)
            showToast(
              info.emailSkipped
                ? `Назначено ${info.createdCount} ${word}. Часть писем перенесена в дайджест (anti-spam).`
                : `Назначено ${info.createdCount} ${word}, ученик получит письма.`,
            )
            bumpReload()
            router.refresh()
          }}
          tariffs={tariffs}
        />
      ) : null}

      {/* Epic B (2026-06-19) — модалки «Дел» учителя. */}
      {modal.kind === 'personal-event-create' ? (
        <PersonalEventCreateModal
          onClose={closeModal}
          onCreated={() => {
            closeModal()
            showToast('Дело создано.')
            bumpReload()
            router.refresh()
          }}
        />
      ) : null}

      {modal.kind === 'personal-event-detail' ? (
        <PersonalEventDetailModal
          row={modal.row}
          onClose={closeModal}
          onAction={(msg) => {
            closeModal()
            showToast(msg)
            bumpReload()
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function TeacherSlotDetailModal({
  row,
  onClose,
  onSuccess,
  onError,
  onRequestReschedule,
}: {
  row: CalendarRow
  onClose: () => void
  // BCS-F.3: split-by-kind success path. Caller passes the resolved
  // user-facing message so we don't display "Слот отменён" after a
  // dismiss/delete-external action that left the slot booked.
  onSuccess: (message: string) => void
  onError: (msg: string) => void
  // Wave-B (2026-06-16) — клик «Перенести» в модалке booked-full
  // переключает CalendarModalState в `teacher-reschedule`. Parent
  // монтирует RescheduleByTeacherModal с тем же row.
  onRequestReschedule?: (row: CalendarRow) => void
}) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  // 2026-06-14 BUG-3a — ESC closes the modal (when no in-flight POST).
  // Mirrors the pattern in AssignDirectModal + MobileCreateFab so every
  // modal on /teacher/calendar has a consistent keyboard close path.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

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
          {/* Wave-B (2026-06-16) — «Перенести» появляется только для
              booked-full (учитель решает что делать с занятием ученика).
              Для open slot переноса нет, потому что drag-to-move уже
              работает в календаре напрямую. */}
          {slot.kind === 'booked-full' && onRequestReschedule ? (
            <button
              type="button"
              onClick={() => onRequestReschedule(row)}
              disabled={busy}
              style={btnSecondary}
            >
              Перенести
            </button>
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
    case 'personal-event':
      // Epic B (2026-06-19) — учительское дело.
      return 'Дело'
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
