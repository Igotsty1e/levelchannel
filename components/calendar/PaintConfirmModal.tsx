'use client'

import { useMemo, useState } from 'react'

import { Modal } from '@/components/ui/primitives'
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

  // ESC + backdrop click + body scroll lock — handled by Modal primitive.

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
    <Modal
      open={true}
      onClose={onCancel}
      busy={busy}
      title={`Новые слоты · ${formatYmdRu(span.ymd)}`}
      size="lg"
    >

        <FieldLabel>Длительность</FieldLabel>
        <ChipGroup
          name="duration"
          value={String(duration)}
          options={ALLOWED_PAINT_DURATIONS_MIN.map((d) => ({
            value: String(d),
            label: `${d} мин`,
          }))}
          onChange={(v) => setDuration(Number(v) as PaintDurationMinutes)}
        />

        <FieldLabel style={{ marginTop: 16 }}>Тариф</FieldLabel>
        {tariffs.length <= 3 ? (
          <ChipGroup
            name="tariff"
            value={tariffId}
            options={[
              { value: '', label: 'Без цены' },
              ...tariffs.map((t) => ({
                value: t.id,
                label: `${t.titleRu} · ${(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽`,
              })),
            ]}
            onChange={setTariffId}
          />
        ) : (
          <select
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
            style={selectStyle}
          >
            <option value="">Без цены</option>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.titleRu} · {(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽
              </option>
            ))}
          </select>
        )}

        <div
          style={{
            background: 'var(--surface-2, rgba(255,255,255,0.04))',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            marginTop: 16,
            marginBottom: 16,
          }}
        >
          {synth ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 0, marginBottom: 8 }}>
                Создадим <strong style={{ color: 'var(--text)' }}>{synth.startsIso.length}</strong>{' '}
                {pluralRu(synth.startsIso.length, 'слот', 'слота', 'слотов')}
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
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {hhmm}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--warning, #fbbf24)', margin: 0 }}>
              Диапазон короче выбранной длительности.
            </p>
          )}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              padding: 12,
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              color: 'var(--text)',
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
            className="btn-secondary"
            style={{ minHeight: 36 }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !synth}
            className="btn-primary"
            style={{ minHeight: 36 }}
          >
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </div>
    </Modal>
  )
}

function FieldLabel({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--secondary)',
        marginBottom: 6,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function ChipGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              border: `1px solid ${isActive ? 'var(--accent, #D88A82)' : 'var(--border)'}`,
              background: isActive
                ? 'var(--accent-bg, rgba(216,138,130,0.10))'
                : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function formatYmdRu(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const sameYear = new Date().getUTCFullYear() === Number(y)
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'var(--surface-2, rgba(255,255,255,0.05))',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  textOverflow: 'ellipsis',
}
