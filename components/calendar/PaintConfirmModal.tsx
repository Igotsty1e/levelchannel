'use client'

import { useMemo, useState } from 'react'

import {
  ALLOWED_PAINT_DURATIONS_MIN,
  type PaintDurationMinutes,
  synthesizePaintSlots,
} from '@/lib/calendar/paint-synth'
import type { PaintSpan } from '@/lib/calendar/drag-state'

// Wave A PR3b — confirm dialog for a paint commit.
//
// User dragged out a span on the operator calendar. Now they pick
// duration (30/60/90/120 min — 50-min single slots use the row form
// per Codex 2026-05-08 design call) and an optional tariff. The
// dialog computes the synthesized list of slot starts on each
// duration change and shows a read-only preview (Codex's "no
// individual deselect" — that breaks the deterministic-batch
// invariant).
//
// On submit: parent's onConfirm runs the POST + refetch flow. This
// dialog just collects parameters and shows what would happen.

export type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

export type PaintConfirmModalProps = {
  span: PaintSpan
  tariffs: ReadonlyArray<TariffOption>
  onConfirm: (params: {
    startsIso: ReadonlyArray<string>
    durationMinutes: PaintDurationMinutes
    tariffId: string | null
  }) => Promise<void>
  onCancel: () => void
}

export function PaintConfirmModal({
  span,
  tariffs,
  onConfirm,
  onCancel,
}: PaintConfirmModalProps) {
  const [duration, setDuration] = useState<PaintDurationMinutes>(60)
  const [tariffId, setTariffId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const synth = useMemo(
    () =>
      synthesizePaintSlots({
        ymd: span.ymd,
        fromHalfHour: span.fromHalfHour,
        toHalfHour: span.toHalfHour,
        durationMinutes: duration,
      }),
    [span, duration],
  )

  async function handleConfirm() {
    if (!synth) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm({
        startsIso: synth.startsIso,
        durationMinutes: duration,
        tariffId: tariffId || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paint-confirm-title"
      // Codex 2026-05-08 MEDIUM 2: backdrop click MUST NOT close the
      // modal while a POST is in flight — that gave the user a
      // misleading "cancelled" UX while creation was actually
      // proceeding. Backdrop click is now a no-op when busy.
      onClick={busy ? undefined : onCancel}
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
        <h2 id="paint-confirm-title" style={{ fontSize: 18, marginBottom: 12 }}>
          Создать слоты — {span.ymd}
        </h2>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Field label="Длительность">
            <select
              value={duration}
              onChange={(e) =>
                setDuration(Number(e.target.value) as PaintDurationMinutes)
              }
              style={selectStyle}
            >
              {ALLOWED_PAINT_DURATIONS_MIN.map((d) => (
                <option key={d} value={d}>
                  {d} мин
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тариф (необязательно)">
            <select
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— без тарифа —</option>
              {tariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.titleRu} ·{' '}
                  {(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          {synth ? (
            <>
              <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
                Будет создано слотов: <strong>{synth.startsIso.length}</strong>
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {synth.startsHhmm.map((hhmm, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(34, 197, 94, 0.15)',
                      border: '1px solid rgba(34, 197, 94, 0.4)',
                      borderRadius: 4,
                      fontSize: 12,
                      color: '#bbf7d0',
                    }}
                  >
                    {hhmm}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#fbbf24', margin: 0 }}>
              Выбранный диапазон короче длительности — ни одного слота
              не помещается. Увеличьте диапазон или уменьшите
              длительность.
            </p>
          )}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#fecaca',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={btnSecondary}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !synth}
            style={btnPrimary}
          >
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: 1,
        // Wave 14 #4 — collapse the column's intrinsic min-content
        // contribution so a wide <select> doesn't blow the row out.
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 12, color: '#9ca3af' }}>{label}</span>
      {children}
    </label>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  fontSize: 13,
  // Wave 14 #4 — keep <select> inside its flex column. Without these
  // the select grew to fit its longest <option> content (e.g. a long
  // tariff title), pushing the modal wider than its maxWidth.
  width: '100%',
  boxSizing: 'border-box',
  // Long option labels truncate visually instead of stretching the
  // select horizontally (Chrome respects this for the closed control).
  textOverflow: 'ellipsis',
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

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(34, 197, 94, 0.18)',
  border: '1px solid rgba(34, 197, 94, 0.55)',
  borderRadius: 6,
  color: '#bbf7d0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
