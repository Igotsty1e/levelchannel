'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Button, ChipGroup } from '@/components/ui/primitives'

import { ModalSheet } from './modal-sheet'

// Create-new-tariff modal/sheet. Triggered from top-of-page «+ Новая
// цена» CTA (desktop) and the FAB (mobile). Behaviour:
//   - title required, price required (integer rubles), duration from
//     ChipGroup (default 60).
//   - on success: parent closes sheet + reloads via SSR refresh.
//   - on error: surface inline; keep input so user can fix.

const DURATION_CHIPS = [
  { value: '30', label: '30 мин' },
  { value: '45', label: '45 мин' },
  { value: '60', label: '60 мин' },
  { value: '90', label: '90 мин' },
  { value: '120', label: '120 мин' },
] as const

type DurationChipValue = (typeof DURATION_CHIPS)[number]['value']

export type TariffCreateSheetProps = {
  onClose: () => void
  onCreate: (input: {
    titleRu: string
    amountKopecks: number
    durationMinutes: number
  }) => Promise<{ ok: true } | { ok: false; message: string }>
}

export function TariffCreateSheet({
  onClose,
  onCreate,
}: TariffCreateSheetProps) {
  const [titleRu, setTitleRu] = useState('')
  const [amountRub, setAmountRub] = useState('1500')
  const [duration, setDuration] = useState<DurationChipValue>('60')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (titleRu.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await onCreate({
        titleRu: titleRu.trim(),
        amountKopecks: Math.round(Number(amountRub) * 100),
        durationMinutes: Number(duration),
      })
      if (!r.ok) {
        setError(r.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalSheet
      title="Новая цена"
      description="Стоимость одного занятия. После того как цена попадёт хотя бы в одно занятие, её сумму и длительность нельзя поменять — придётся создать новую."
      onClose={onClose}
      locked={busy}
    >
      <form className="pricing-create-form" onSubmit={handleSubmit}>
        <div className="pricing-field">
          <label htmlFor="tariff-new-title" className="pricing-field-label">
            Название
          </label>
          <input
            id="tariff-new-title"
            className="pricing-input"
            type="text"
            value={titleRu}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setTitleRu(e.target.value)
            }
            maxLength={120}
            autoFocus
            autoComplete="off"
            placeholder="Например, «Стандарт» или «Интенсив»"
          />
          <p className="pricing-field-hint">
            Видят ваши ученики. Короткое имя — лучше: помещается на кнопках.
          </p>
        </div>

        <div className="pricing-field">
          <label htmlFor="tariff-new-amount" className="pricing-field-label">
            Цена, ₽
          </label>
          <input
            id="tariff-new-amount"
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

        <div className="pricing-field">
          <span className="pricing-field-label">Длительность</span>
          <ChipGroup
            name="duration"
            value={duration}
            options={DURATION_CHIPS}
            onChange={(next) => setDuration(next as DurationChipValue)}
          />
        </div>

        {error ? (
          <div role="alert" className="pricing-field-error">
            {error}
          </div>
        ) : null}

        <div className="pricing-create-actions">
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || titleRu.trim().length === 0}
            loading={busy}
          >
            Создать
          </Button>
        </div>
      </form>
    </ModalSheet>
  )
}
