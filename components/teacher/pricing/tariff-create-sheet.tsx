'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Button } from '@/components/ui/primitives'

import { ModalSheet } from './modal-sheet'

// Create-new-tariff modal/sheet. Triggered from top-of-page «+ Новая
// цена» CTA (desktop) and the FAB (mobile). Behaviour:
//   - title required, price required (integer rubles), duration —
//     minute-level input (15..240). Был ChipGroup на 30/45/60/90/120;
//     убран 2026-06-11 (minute-duration epic) — учителю нужна точная
//     минутная длительность.
//   - on success: parent closes sheet + reloads via SSR refresh.
//   - on error: surface inline; keep input so user can fix.

const TARIFF_DURATION_MIN = 15
const TARIFF_DURATION_MAX = 240

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
  const [duration, setDuration] = useState('60')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (titleRu.trim().length === 0) return
    const durationNum = Number(duration)
    if (
      !Number.isInteger(durationNum)
      || durationNum < TARIFF_DURATION_MIN
      || durationNum > TARIFF_DURATION_MAX
    ) {
      setError(
        `Длительность — целое число от ${TARIFF_DURATION_MIN} до ${TARIFF_DURATION_MAX} минут.`,
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await onCreate({
        titleRu: titleRu.trim(),
        amountKopecks: Math.round(Number(amountRub) * 100),
        durationMinutes: durationNum,
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
          <label htmlFor="tariff-new-duration" className="pricing-field-label">
            Длительность, мин
          </label>
          <input
            id="tariff-new-duration"
            className="pricing-input pricing-input-money"
            type="number"
            inputMode="numeric"
            step="1"
            min={TARIFF_DURATION_MIN}
            max={TARIFF_DURATION_MAX}
            value={duration}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setDuration(e.target.value.replace(/[^0-9]/g, ''))
            }
          />
          <p className="pricing-field-hint">
            От {TARIFF_DURATION_MIN} до {TARIFF_DURATION_MAX} минут.
          </p>
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
