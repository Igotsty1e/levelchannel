'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Button, Pill } from '@/components/ui/primitives'

import { ArchiveConfirm } from './archive-confirm'
import {
  formatDurationMinutes,
  formatLessonsCount,
  formatRubles,
} from './format'

// Read-mode card for a single package on /teacher/packages.
//
// Server-side immutability is wider here than for tariffs: count,
// duration_minutes, amount_kopecks, currency are ALL frozen after the
// first purchase (DB trigger lesson_packages_economic_fields_immutable
// from mig 0033). The route also pre-rejects any body that names them.
// So the edit form only exposes metadata fields: title + description +
// "доступен ли пакет" (is_active). Hidden behind expand-on-tap.

export type PackageView = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  currency: string
  isActive: boolean
  displayOrder: number
}

export type PackageCardProps = {
  pkg: PackageView
  onSave: (patch: {
    titleRu: string
    descriptionRu: string | null
    isActive: boolean
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  onArchive: () => Promise<{ ok: true } | { ok: false; message: string }>
  onReactivate: () => Promise<{ ok: true } | { ok: false; message: string }>
}

export function PackageCard({
  pkg,
  onSave,
  onArchive,
  onReactivate,
}: PackageCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [titleRu, setTitleRu] = useState(pkg.titleRu)
  const [descriptionRu, setDescriptionRu] = useState(pkg.descriptionRu ?? '')
  const [isActive, setIsActive] = useState(pkg.isActive)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  function reset(): void {
    setTitleRu(pkg.titleRu)
    setDescriptionRu(pkg.descriptionRu ?? '')
    setIsActive(pkg.isActive)
    setSaveError(null)
  }

  function close(): void {
    reset()
    setExpanded(false)
  }

  async function handleSave(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    setBusy(true)
    setSaveError(null)
    try {
      const r = await onSave({
        titleRu: titleRu.trim(),
        descriptionRu: descriptionRu.trim() || null,
        isActive,
      })
      if (!r.ok) {
        setSaveError(r.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={`pricing-card${expanded ? ' pricing-card-expanded' : ''}${pkg.isActive ? '' : ' pricing-card-archived-soft'}`}
    >
      <button
        type="button"
        className="pricing-card-read"
        aria-expanded={expanded}
        aria-controls={`pkg-edit-${pkg.id}`}
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
            {pkg.titleRu || 'Без названия'}
          </span>
          {pkg.isActive ? (
            <Pill tone="success">активен</Pill>
          ) : (
            <Pill tone="warning">в архиве</Pill>
          )}
        </div>
        <div className="pricing-card-amount">
          {formatRubles(pkg.amountKopecks)}
          <span className="pricing-card-amount-sep">·</span>
          <span className="pricing-card-amount-meta">
            {formatLessonsCount(pkg.count)} ×{' '}
            {formatDurationMinutes(pkg.durationMinutes)}
          </span>
        </div>
        {pkg.descriptionRu ? (
          <p className="pricing-card-description">{pkg.descriptionRu}</p>
        ) : null}
        <span aria-hidden="true" className="pricing-card-chevron">
          {expanded ? '−' : '✎'}
        </span>
      </button>

      {expanded ? (
        <form
          id={`pkg-edit-${pkg.id}`}
          className="pricing-card-edit"
          onSubmit={handleSave}
        >
          <div className="pricing-immutable-note">
            <strong>Цена, количество занятий и длительность — заморожены.</strong>
            <span>
              Эти параметры нельзя поменять после первой покупки. Чтобы
              изменить — архивируйте этот пакет и создайте новый.
            </span>
          </div>

          <div className="pricing-field">
            <label htmlFor={`pkg-title-${pkg.id}`} className="pricing-field-label">
              Название
            </label>
            <input
              id={`pkg-title-${pkg.id}`}
              className="pricing-input"
              type="text"
              value={titleRu}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setTitleRu(e.target.value)
              }
              maxLength={120}
              autoComplete="off"
            />
          </div>

          <div className="pricing-field">
            <label
              htmlFor={`pkg-desc-${pkg.id}`}
              className="pricing-field-label"
            >
              Описание <span className="pricing-field-label-aux">— по желанию</span>
            </label>
            <textarea
              id={`pkg-desc-${pkg.id}`}
              className="pricing-input pricing-textarea"
              value={descriptionRu}
              onChange={(e) => setDescriptionRu(e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="Например, «8 занятий по 60 минут, действуют 2 месяца»."
            />
          </div>

          <label className="pricing-toggle">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Пакет доступен ученикам для покупки</span>
          </label>

          {saveError ? (
            <div role="alert" className="pricing-field-error">
              {saveError}
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
            {pkg.isActive ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmArchive(true)}
                title="Скроет из каталога; уже купленные — продолжают работать"
              >
                Архивировать
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  setSaveError(null)
                  try {
                    const r = await onReactivate()
                    if (!r.ok) setSaveError(r.message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Вернуть в каталог
              </Button>
            )}
          </div>
        </form>
      ) : null}

      {confirmArchive ? (
        <ArchiveConfirm
          title={`Архивировать пакет «${pkg.titleRu || 'без названия'}»?`}
          body="Пакет пропадёт из каталога для новых учеников. Уже купленные пакеты продолжат работать до конца — ничего не сгорает."
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
