'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'

import {
  Button,
  ChipGroup,
  Pill,
} from '@/components/ui/primitives'
import type { PricingTariff } from '@/lib/pricing/tariffs'

import { ArchiveConfirm } from './archive-confirm'
import { formatDurationMinutes, formatRubles } from './format'

// Read-mode card for a single tariff on /teacher/tariffs.
//
// Layout: full-width card; title big, price accent + tabular-nums,
// duration + status pills below. Tap the card → it expands into an
// edit form inline (no full-screen sheet for edit, because tutor edits
// one card at a time and benefits from in-place context).
//
// Server-side immutability: when the tariff has been used in a slot,
// the API returns 409 on amount_kopecks / duration_minutes change. We
// don't pre-disable the inputs (no cheap client-side way to know
// "has any slot used this"), but we show the conflict copy + a
// secondary CTA to «создать новую цену» on the 409.

const DURATION_CHIPS = [
  { value: '30', label: '30 мин' },
  { value: '45', label: '45 мин' },
  { value: '60', label: '60 мин' },
  { value: '90', label: '90 мин' },
  { value: '120', label: '120 мин' },
] as const

type DurationChipValue = (typeof DURATION_CHIPS)[number]['value']

export type TariffCardProps = {
  tariff: PricingTariff
  onSave: (patch: {
    titleRu: string
    amountKopecks: number
    durationMinutes: number
    isActive: boolean
  }) => Promise<{ ok: true } | { ok: false; message: string; code?: string }>
  onArchive: () => Promise<{ ok: true } | { ok: false; message: string }>
}

export function TariffCard({ tariff, onSave, onArchive }: TariffCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [titleRu, setTitleRu] = useState(tariff.titleRu)
  const [amountRub, setAmountRub] = useState(
    String(Math.round(tariff.amountKopecks / 100)),
  )
  const [duration, setDuration] = useState<string>(
    String(tariff.durationMinutes),
  )
  const [isActive, setIsActive] = useState(tariff.isActive)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveErrorCode, setSaveErrorCode] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const isCustomDuration = !DURATION_CHIPS.some(
    (c) => c.value === String(tariff.durationMinutes),
  )

  function reset(): void {
    setTitleRu(tariff.titleRu)
    setAmountRub(String(Math.round(tariff.amountKopecks / 100)))
    setDuration(String(tariff.durationMinutes))
    setIsActive(tariff.isActive)
    setSaveError(null)
    setSaveErrorCode(null)
  }

  function close(): void {
    reset()
    setExpanded(false)
  }

  async function handleSave(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    setBusy(true)
    setSaveError(null)
    setSaveErrorCode(null)
    try {
      const r = await onSave({
        titleRu: titleRu.trim(),
        amountKopecks: Math.round(Number(amountRub) * 100),
        durationMinutes: Number(duration),
        isActive,
      })
      if (!r.ok) {
        setSaveError(r.message)
        setSaveErrorCode(r.code ?? null)
      }
    } finally {
      setBusy(false)
    }
  }

  const accentForActive = tariff.isActive
  const isImmutable409 =
    saveErrorCode === 'amountKopecks/immutable_after_first_slot_reference'
    || saveErrorCode === 'durationMinutes/immutable_after_first_slot_reference'

  return (
    <article
      className={`pricing-card${expanded ? ' pricing-card-expanded' : ''}${accentForActive ? '' : ' pricing-card-archived-soft'}`}
    >
      <button
        type="button"
        className="pricing-card-read"
        aria-expanded={expanded}
        aria-controls={`tariff-edit-${tariff.id}`}
        onClick={() => {
          if (expanded) {
            close()
          } else {
            setExpanded(true)
          }
        }}
      >
        <div className="pricing-card-title-row">
          <span className="pricing-card-title">
            {tariff.titleRu || 'Без названия'}
          </span>
          {tariff.isActive ? (
            <Pill tone="success">активна</Pill>
          ) : (
            <Pill>отключена</Pill>
          )}
        </div>
        <div className="pricing-card-amount">
          {formatRubles(tariff.amountKopecks)}
          <span className="pricing-card-amount-sep">·</span>
          <span className="pricing-card-amount-meta">
            {formatDurationMinutes(tariff.durationMinutes)}
          </span>
        </div>
        <span aria-hidden="true" className="pricing-card-chevron">
          {expanded ? '−' : '✎'}
        </span>
      </button>

      {expanded ? (
        <form
          id={`tariff-edit-${tariff.id}`}
          className="pricing-card-edit"
          onSubmit={handleSave}
        >
          <div className="pricing-field">
            <label htmlFor={`tariff-title-${tariff.id}`} className="pricing-field-label">
              Название
            </label>
            <input
              id={`tariff-title-${tariff.id}`}
              className="pricing-input"
              type="text"
              value={titleRu}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setTitleRu(e.target.value)
              }
              maxLength={120}
              autoComplete="off"
              placeholder="Например, «Стандарт» или «Долгий формат»"
            />
          </div>

          <div className="pricing-field-row">
            <div className="pricing-field">
              <label htmlFor={`tariff-amount-${tariff.id}`} className="pricing-field-label">
                Цена, ₽
              </label>
              <input
                id={`tariff-amount-${tariff.id}`}
                className="pricing-input pricing-input-money"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={amountRub}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setAmountRub(e.target.value.replace(/[^0-9]/g, ''))
                }
              />
            </div>
            <div className="pricing-field pricing-field-grow">
              <span className="pricing-field-label">Длительность</span>
              {isCustomDuration ? (
                <p className="pricing-field-hint">
                  {formatDurationMinutes(Number(duration))} — нестандартная,
                  останется как есть.
                </p>
              ) : (
                <ChipGroup
                  name="duration"
                  value={duration as DurationChipValue}
                  options={DURATION_CHIPS}
                  onChange={(next) => setDuration(next)}
                  size="sm"
                />
              )}
            </div>
          </div>

          <label className="pricing-toggle">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Цена доступна для новых занятий</span>
          </label>

          {saveError ? (
            <div role="alert" className="pricing-field-error">
              {isImmutable409
                ? saveError + ' Создайте новую цену с нужными параметрами.'
                : saveError}
            </div>
          ) : null}

          <div className="pricing-card-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={busy}
              disabled={busy || titleRu.trim().length === 0}
            >
              Сохранить
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={close}
            >
              Отмена
            </Button>
            <div className="pricing-card-actions-spacer" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmArchive(true)}
              title="Скроет из новых занятий; история сохранится"
            >
              Архивировать
            </Button>
          </div>
        </form>
      ) : null}

      {confirmArchive ? (
        <ArchiveConfirm
          title={`Архивировать цену «${tariff.titleRu || 'без названия'}»?`}
          body="Цена больше не появится в новых занятиях. Уже созданные занятия сохранят её сумму и название — в истории ничего не пропадёт."
          errorMessage={archiveError}
          busy={busy}
          onCancel={() => {
            setConfirmArchive(false)
            setArchiveError(null)
          }}
          onConfirm={async () => {
            setBusy(true)
            setArchiveError(null)
            try {
              const r = await onArchive()
              if (!r.ok) {
                setArchiveError(r.message)
              }
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : null}
    </article>
  )
}
