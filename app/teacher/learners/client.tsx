'use client'

// Mobile-first cabinet restructure (2026-05-31) — learners list client.
//
// 3 фильтра вверху: поиск + tabs (Активные / Архив / Все).
// На mobile (<768px) — карточки. На desktop — таблица.
//
// Cabinet polish 2026-06-07 (B3) — empty-state теперь через <EmptyState>
// + Pill для read-only «архив»/«оплата». ChipGroup для фильтра.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { Button, ChipGroup, EmptyState, Pill } from '@/components/ui/primitives'

const PAGE_SIZE = 10

type LearnerRow = {
  learnerId: string
  learnerEmail: string
  displayName: string | null
  firstName: string | null
  lastName: string | null
  isAssigned: boolean
  upcomingCount: number
  completedCount: number
  cancelledCount: number
  noShowCount: number
  // mig 0101 — выбранный учителем метод оплаты. 'none' = booking
  // блокируется до выбора. Read-only здесь; toggle на детальной странице.
  // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
  paymentMethod: 'postpaid' | 'none'
}

// PAYMENT_METHOD_LABEL убран (post-deploy bug bash 2026-06-19) — owner
// решил спрятать «постоплата» рудимент. domain field paymentMethod
// остаётся в DTO для backward-compat с legacy кодом.

type Filter = 'active' | 'archive' | 'all'

const FILTER_LABELS: Record<Filter, string> = {
  active: 'Активные',
  archive: 'Архив',
  all: 'Все',
}

function renderName(l: LearnerRow): string {
  return formatProfileNameForRender({
    firstName: l.firstName,
    lastName: l.lastName,
    displayName: l.displayName,
    fallbackEmail: l.learnerEmail,
  })
}

export function LearnersListClient({ learners }: { learners: LearnerRow[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [currentPage, setCurrentPage] = useState(1)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = learners.filter((l) => {
      if (filter === 'active' && !l.isAssigned) return false
      if (filter === 'archive' && l.isAssigned) return false
      if (q) {
        const haystack = `${renderName(l)} ${l.learnerEmail}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    // Sort by display name a-z, case-insensitive, RU-aware (owner ask
    // 2026-06-11). Was previously DB-order (undefined for the UI).
    matches.sort((a, b) =>
      renderName(a)
        .toLocaleLowerCase('ru-RU')
        .localeCompare(renderName(b).toLocaleLowerCase('ru-RU'), 'ru-RU'),
    )
    return matches
  }, [learners, query, filter])

  const counts = useMemo(() => {
    return {
      active: learners.filter((l) => l.isAssigned).length,
      archive: learners.filter((l) => !l.isAssigned).length,
      all: learners.length,
    }
  }, [learners])

  // Reset to page 1 when the filter/search narrows the result set.
  useEffect(() => {
    setCurrentPage(1)
  }, [query, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paged = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )
  const showPagination = filtered.length > PAGE_SIZE

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <input
          type="search"
          placeholder="Поиск по имени или e-mail…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск учеников"
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 14,
            minHeight: 44,
          }}
        />

        <ChipGroup
          name="Фильтр учеников"
          value={filter}
          onChange={setFilter}
          options={(['active', 'archive', 'all'] as Filter[]).map((f) => ({
            value: f,
            label: `${FILTER_LABELS[f]} · ${counts[f]}`,
          }))}
        />
      </div>

      {filtered.length === 0 ? (
        learners.length === 0 ? (
          <EmptyState
            title="Пока учеников нет"
            body="Пригласите первого ученика — ссылка приходит ему в e-mail и действует 7 дней."
            action={<Button href="/teacher">Создать приглашение</Button>}
          />
        ) : (
          <EmptyState
            title="Никто не найден"
            body="Поправьте запрос или переключите фильтр выше."
          />
        )
      ) : (
        <>
          {/* Карточный layout — основной для mobile, для desktop тоже OK. */}
          <ul
            className="learner-card-list"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {paged.map((l) => {
              // first render — same as full list iter
              const name = renderName(l)
              const showEmail = name !== l.learnerEmail
              return (
                <li key={l.learnerId}>
                  <Link
                    href={`/teacher/learners/${l.learnerId}`}
                    className="learner-card"
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>
                        {name}
                      </span>
                      {!l.isAssigned ? (
                        <Pill size="sm">архив</Pill>
                      ) : null}
                    </div>
                    {showEmail ? (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--secondary)',
                          display: 'block',
                          marginTop: 2,
                        }}
                      >
                        {l.learnerEmail}
                      </span>
                    ) : null}
                    <div className="learner-card-stats">
                      <span className="learner-card-stat">
                        <strong>{l.upcomingCount}</strong>будущих
                      </span>
                      <span className="learner-card-stat">
                        <strong>{l.completedCount}</strong>проведено
                      </span>
                      {l.cancelledCount > 0 ? (
                        <span className="learner-card-stat">
                          <strong>{l.cancelledCount}</strong>отменено
                        </span>
                      ) : null}
                      {l.noShowCount > 0 ? (
                        <span className="learner-card-stat">
                          <strong>{l.noShowCount}</strong>не пришёл
                        </span>
                      ) : null}
                      {/* «оплата: постоплата/не выбран» убрано
                          (post-deploy bug bash 2026-06-19) — owner-фидбэк
                          о рудиментe. Состояние биллинга показывается
                          через предупреждения в AssignDirectModal. */}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>

          {showPagination ? (
            <nav
              aria-label="Постраничная навигация"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                aria-label="Предыдущая страница"
                style={paginationBtnStyle(safePage <= 1)}
              >
                ←
              </button>
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary, var(--secondary))',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 64,
                  textAlign: 'center',
                }}
              >
                {safePage} из {totalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={safePage >= totalPages}
                aria-label="Следующая страница"
                style={paginationBtnStyle(safePage >= totalPages)}
              >
                →
              </button>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    minWidth: 40,
    minHeight: 40,
    padding: '8px 12px',
    background: disabled ? 'transparent' : 'var(--surface-2)',
    color: disabled
      ? 'var(--text-tertiary)'
      : 'var(--text-primary, var(--text))',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
