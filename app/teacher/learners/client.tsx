'use client'

// Mobile-first cabinet restructure (2026-05-31) — learners list client.
//
// 3 фильтра вверху: поиск + tabs (Активные / Архив / Все).
// На mobile (<768px) — карточки. На desktop — таблица.
//
// Cabinet polish 2026-06-07 (B3) — empty-state теперь через <EmptyState>
// + Pill для read-only «архив»/«оплата». ChipGroup для фильтра.
import Link from 'next/link'
import { useMemo, useState } from 'react'

import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { Button, ChipGroup, EmptyState, Pill } from '@/components/ui/primitives'

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
  paymentMethod: 'postpaid' | 'prepaid_packages' | 'none'
}

const PAYMENT_METHOD_LABEL: Record<LearnerRow['paymentMethod'], string> = {
  postpaid: 'постоплата',
  prepaid_packages: 'пакеты',
  none: 'не выбран',
}

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return learners.filter((l) => {
      if (filter === 'active' && !l.isAssigned) return false
      if (filter === 'archive' && l.isAssigned) return false
      if (q) {
        const haystack = `${renderName(l)} ${l.learnerEmail}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [learners, query, filter])

  const counts = useMemo(() => {
    return {
      active: learners.filter((l) => l.isAssigned).length,
      archive: learners.filter((l) => !l.isAssigned).length,
      all: learners.length,
    }
  }, [learners])

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
            {filtered.map((l) => {
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
                      <span
                        className="learner-card-stat"
                        style={{
                          color:
                            l.paymentMethod === 'none'
                              ? 'var(--warning)'
                              : undefined,
                        }}
                        title="Способ оплаты — выбирается на странице ученика"
                      >
                        оплата: {PAYMENT_METHOD_LABEL[l.paymentMethod]}
                      </span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
