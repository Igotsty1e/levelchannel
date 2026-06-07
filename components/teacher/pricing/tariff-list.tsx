'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  Banner,
  Button,
  EmptyState,
  FloatingActionButton,
  Pill,
} from '@/components/ui/primitives'
import type { PricingTariff } from '@/lib/pricing/tariffs'

import { CapBanners } from './cap-banners'
import { formatDurationMinutes, formatRubles } from './format'
import { TariffCard } from './tariff-card'
import { TariffCreateSheet } from './tariff-create-sheet'

// Client island for /teacher/tariffs — read-by-default card list with
// expand-to-edit, plus a modal create flow.
//
// Component tree:
//   <TariffList>
//     ├─ <CapBanners>           — plan-tier write-cap status (1 banner max)
//     ├─ <Banner error>          — last API error, if any
//     ├─ desktop header CTA OR <EmptyState> when zero tariffs
//     ├─ <TariffCard …>[]        — read mode → tap → inline edit
//     ├─ archive section (lazy show)
//     ├─ <TariffCreateSheet>     — when openCreate=true
//     └─ <FloatingActionButton>  — mobile primary CTA (CSS-hidden ≥768px)
//
// All mutations route through the same fetch helper which surfaces
// API JSON error messages back to children (saveError / archiveError).
//
// Anti-spoof: route handlers bind teacher_id from session; we never
// send it in the body.

export type TariffListProps = {
  initialTariffs: PricingTariff[]
  /** -1 = unlimited; 0 = no creates; 1+ = literal cap. */
  writeCap: number
  /** Server-counted active rows (deleted_at IS NULL). */
  currentActiveCount: number
  /** SSR-resolved «show archived» toggle from ?archived=1. */
  showArchived: boolean
}

export function TariffList({
  initialTariffs,
  writeCap,
  currentActiveCount,
  showArchived,
}: TariffListProps) {
  const router = useRouter()
  const [openCreate, setOpenCreate] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const isUnlimited = writeCap < 0
  const noCreatesAtAll = !isUnlimited && writeCap === 0
  const atCap = !isUnlimited && writeCap > 0 && currentActiveCount >= writeCap
  const canCreate = !noCreatesAtAll && !atCap

  const active = initialTariffs.filter((t) => t.deletedAt === null)
  const archived = initialTariffs.filter((t) => t.deletedAt !== null)

  async function apiPatch(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string; code?: string }> {
    try {
      const res = await fetch(`/api/teacher/tariffs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        const message: string =
          data?.message || data?.error || `HTTP ${res.status}`
        return { ok: false, message, code: data?.error }
      }
      router.refresh()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return { ok: false, message }
    }
  }

  async function apiArchive(
    id: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch(`/api/teacher/tariffs/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        const message: string =
          data?.message || data?.error || `HTTP ${res.status}`
        return { ok: false, message }
      }
      router.refresh()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return { ok: false, message }
    }
  }

  async function apiCreate(input: {
    titleRu: string
    amountKopecks: number
    durationMinutes: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch('/api/teacher/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          isActive: true,
          displayOrder: 0,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        const message: string =
          data?.message || data?.error || `HTTP ${res.status}`
        return { ok: false, message }
      }
      setOpenCreate(false)
      router.refresh()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      setPageError(message)
      return { ok: false, message }
    }
  }

  const hasAny = active.length > 0

  return (
    <div className="pricing-stack">
      <CapBanners
        writeCap={writeCap}
        currentActiveCount={currentActiveCount}
        noun="цен"
        singularPhrase="цен занятий"
        atCapCopy="Лимит цен исчерпан. Архивируйте старую цену, чтобы создать новую."
      />

      {pageError ? (
        <Banner tone="danger" icon="⚠">
          {pageError}
        </Banner>
      ) : null}

      {/* Top-of-page primary action — visible on desktop, hidden on
          mobile (FAB covers that). Hides entirely when create is
          disabled at the cap. */}
      {canCreate ? (
        <div className="pricing-header-actions">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setOpenCreate(true)}
            iconLeft={<span aria-hidden="true">+</span>}
          >
            Новая цена
          </Button>
        </div>
      ) : null}

      {!hasAny ? (
        <EmptyState
          title="Цен пока нет"
          body="Создайте первую цену занятия, чтобы вести расписание с ученикaми на постоплате. Можно создать несколько — для разных форматов и длительностей."
          action={
            canCreate ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setOpenCreate(true)}
              >
                Создать первую цену
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="pricing-list" role="list">
          {active.map((t) => (
            <li key={t.id}>
              <TariffCard
                tariff={t}
                onSave={(patch) => apiPatch(t.id, patch)}
                onArchive={() => apiArchive(t.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="pricing-archive-toggle">
        <Link
          href={
            showArchived ? '/teacher/tariffs' : '/teacher/tariffs?archived=1'
          }
          className="pricing-archive-link"
        >
          {showArchived ? '← Скрыть архив' : 'Показать архив'}
        </Link>
      </div>

      {showArchived ? (
        <section className="pricing-archive-section" aria-label="Архив цен">
          {archived.length === 0 ? (
            <p className="pricing-archive-empty">
              Архив пуст — вы ничего ещё не архивировали.
            </p>
          ) : (
            <ul className="pricing-list pricing-list-archive" role="list">
              {archived.map((t) => (
                <li key={t.id}>
                  <article className="pricing-card pricing-card-archived">
                    <div className="pricing-card-read pricing-card-read-static">
                      <div className="pricing-card-title-row">
                        <span className="pricing-card-title">
                          {t.titleRu || 'Без названия'}
                        </span>
                        <Pill tone="warning">в архиве</Pill>
                      </div>
                      <div className="pricing-card-amount pricing-card-amount-muted">
                        {formatRubles(t.amountKopecks)}
                        <span className="pricing-card-amount-sep">·</span>
                        <span className="pricing-card-amount-meta">
                          {formatDurationMinutes(t.durationMinutes)}
                        </span>
                      </div>
                      <div className="pricing-card-archive-meta">
                        Архивировано{' '}
                        {t.deletedAt
                          ? new Date(t.deletedAt).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'long',
                            })
                          : '—'}
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {openCreate ? (
        <TariffCreateSheet
          onClose={() => setOpenCreate(false)}
          onCreate={apiCreate}
        />
      ) : null}

      {canCreate ? (
        <FloatingActionButton
          label="Новая цена"
          onClick={() => setOpenCreate(true)}
          className="pricing-fab"
        />
      ) : null}
    </div>
  )
}
