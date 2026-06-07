'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Button, ChipGroup } from '@/components/ui/primitives'

import { ModalSheet } from './modal-sheet'

// Create-new-package modal/sheet. Triggered from top-of-page «+ Новый
// пакет» (desktop) and the FAB (mobile).
//
// Tutor mental model: most packages are round numbers (4/8/12/16 lessons,
// 60-min lessons). ChipGroup for the common shapes, "другое" toggle for
// the rare custom case. No display_order field — packages go in created
// order; if reordering matters, that's a follow-up product decision.

const COUNT_CHIPS = [
  { value: '4', label: '4 занятия' },
  { value: '8', label: '8 занятий' },
  { value: '12', label: '12 занятий' },
  { value: '16', label: '16 занятий' },
] as const

type CountChipValue = (typeof COUNT_CHIPS)[number]['value'] | 'custom'

const DURATION_CHIPS = [
  { value: '30', label: '30 мин' },
  { value: '45', label: '45 мин' },
  { value: '60', label: '60 мин' },
  { value: '90', label: '90 мин' },
  { value: '120', label: '120 мин' },
] as const

type DurationChipValue = (typeof DURATION_CHIPS)[number]['value']

export type PackageCreateSheetProps = {
  onClose: () => void
  onCreate: (input: {
    titleRu: string
    descriptionRu: string | null
    durationMinutes: number
    count: number
    amountKopecks: number
  }) => Promise<{ ok: true } | { ok: false; message: string }>
}

export function PackageCreateSheet({
  onClose,
  onCreate,
}: PackageCreateSheetProps) {
  const [titleRu, setTitleRu] = useState('')
  const [descriptionRu, setDescriptionRu] = useState('')
  const [countChoice, setCountChoice] = useState<CountChipValue>('8')
  const [customCount, setCustomCount] = useState('10')
  const [duration, setDuration] = useState<DurationChipValue>('60')
  const [amountRub, setAmountRub] = useState('11500')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveCount =
    countChoice === 'custom' ? Number(customCount) || 0 : Number(countChoice)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (titleRu.trim().length === 0) return
    if (effectiveCount <= 0) {
      setError('Укажите количество занятий в пакете.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await onCreate({
        titleRu: titleRu.trim(),
        descriptionRu: descriptionRu.trim() || null,
        durationMinutes: Number(duration),
        count: effectiveCount,
        amountKopecks: Math.round(Number(amountRub) * 100),
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
      title="Новый пакет"
      description="Пакет — это предоплата за N занятий. После первой покупки цена, длительность и количество занятий замораживаются. Чтобы изменить — создаёте новый пакет и архивируете старый."
      onClose={onClose}
      locked={busy}
    >
      <form className="pricing-create-form" onSubmit={handleSubmit}>
        <div className="pricing-field">
          <label htmlFor="pkg-new-title" className="pricing-field-label">
            Название
          </label>
          <input
            id="pkg-new-title"
            className="pricing-input"
            type="text"
            value={titleRu}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setTitleRu(e.target.value)
            }
            maxLength={120}
            autoFocus
            autoComplete="off"
            placeholder="Например, «8 занятий по 60 минут»"
          />
        </div>

        <div className="pricing-field">
          <span className="pricing-field-label">Количество занятий</span>
          <ChipGroup
            name="count"
            value={countChoice}
            options={[
              ...COUNT_CHIPS,
              { value: 'custom' as const, label: 'Другое' },
            ]}
            onChange={(next) => setCountChoice(next as CountChipValue)}
          />
          {countChoice === 'custom' ? (
            <input
              className="pricing-input pricing-input-money"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              max="365"
              value={customCount}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setCustomCount(e.target.value.replace(/[^0-9]/g, ''))
              }
              style={{ marginTop: 8, maxWidth: 140 }}
            />
          ) : null}
        </div>

        <div className="pricing-field">
          <span className="pricing-field-label">Длительность одного занятия</span>
          <ChipGroup
            name="duration"
            value={duration}
            options={DURATION_CHIPS}
            onChange={(next) => setDuration(next as DurationChipValue)}
          />
        </div>

        <div className="pricing-field">
          <label htmlFor="pkg-new-amount" className="pricing-field-label">
            Цена за весь пакет, ₽
          </label>
          <input
            id="pkg-new-amount"
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
          <p className="pricing-field-hint">
            {effectiveCount > 0 && Number(amountRub) > 0
              ? `~${new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(Math.round(Number(amountRub) / effectiveCount))} за занятие`
              : 'Цена за весь пакет — обычно ниже, чем за разовые занятия.'}
          </p>
        </div>

        <div className="pricing-field">
          <label htmlFor="pkg-new-desc" className="pricing-field-label">
            Описание <span className="pricing-field-label-aux">— по желанию</span>
          </label>
          <textarea
            id="pkg-new-desc"
            className="pricing-input pricing-textarea"
            value={descriptionRu}
            onChange={(e) => setDescriptionRu(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder="Например, «Действует 2 месяца с момента покупки»."
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
            disabled={busy || titleRu.trim().length === 0 || effectiveCount <= 0}
            loading={busy}
          >
            Создать
          </Button>
        </div>
      </form>
    </ModalSheet>
  )
}
