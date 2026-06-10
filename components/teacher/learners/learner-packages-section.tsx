'use client'

import { CSSProperties, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, EmptyState, Pill } from '@/components/ui/primitives'

import { plural } from '@/lib/text/plural'

// LearnerPackagesSection — list of one learner's active package
// purchases under this teacher + revoke + open-issue-modal CTA.
//
// Plan: docs/plans/package-issuance-ux-2026-06-10-v3.md §3.3.
//
// Collapsed-by-default on mobile via CSS media-query (R20-1 — no
// useState+window.innerWidth, no hydration mismatch). Toggle button
// flips a `data-mobile-collapsed` attribute on the wrapper; the
// section content's display is controlled by `:where()` CSS
// selector that respects the attribute only on <640px viewports.
//
// Focus-revalidate (R26-1) — section listens to the `window.focus`
// event with 500ms debounce and calls `router.refresh()` so the data
// auto-updates when the teacher comes back from another tab where
// they revoked / re-issued.

export type LearnerPackageRow = {
  purchaseId: string
  titleRu: string
  countRemaining: number
  countInitial: number
  expiresAt: string
  grantedAt: string
  hasActiveConsumptions: boolean
}

export type LearnerPackagesSectionProps = {
  teacherId: string
  learnerId: string
  rows: ReadonlyArray<LearnerPackageRow>
  teacherHasAnyPackage: boolean
  /** Called when the «+ Выдать пакет» CTA is clicked. */
  onOpenIssueModal: () => void
}

export function LearnerPackagesSection({
  rows,
  teacherHasAnyPackage,
  onOpenIssueModal,
}: LearnerPackagesSectionProps) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const focusDebounce = useRef<number | null>(null)

  // focus-revalidate (R26-1) — debounced
  useEffect(() => {
    function onFocus() {
      if (focusDebounce.current !== null) {
        window.clearTimeout(focusDebounce.current)
      }
      focusDebounce.current = window.setTimeout(() => {
        router.refresh()
      }, 500)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (focusDebounce.current !== null) {
        window.clearTimeout(focusDebounce.current)
      }
    }
  }, [router])

  async function handleRevoke(purchaseId: string, titleRu: string) {
    if (busyId !== null) return
    setBusyId(purchaseId)
    setError(null)
    try {
      const res = await fetch(`/api/teacher/packages/${purchaseId}/revoke`, {
        method: 'DELETE',
      })
      if (res.status === 401) {
        const next = encodeURIComponent(window.location.pathname)
        window.location.href = `/login?next=${next}`
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        setError(body?.message || body?.error || `HTTP ${res.status}`)
        return
      }
      // ensure section is expanded so the teacher sees the update
      setCollapsed(false)
      setAnnouncement(`Пакет «${titleRu}» отозван.`)
      window.setTimeout(() => setAnnouncement(null), 4000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setBusyId(null)
    }
  }

  const n = rows.length
  const hasAny = n > 0

  // On mobile, an empty section stays expanded so the EmptyState
  // CTA is reachable without an extra tap (M-R3-1).
  const dataMobileCollapsed = hasAny && collapsed
  const sectionId = 'learner-packages-content'

  return (
    <section
      className="learner-section"
      data-mobile-collapsed={dataMobileCollapsed ? 'true' : 'false'}
      style={cardStyle}
      aria-labelledby="learner-packages-title"
    >
      <button
        type="button"
        onClick={() => hasAny && setCollapsed((v) => !v)}
        aria-expanded={!collapsed || !hasAny}
        aria-controls={sectionId}
        style={headerStyle}
        disabled={!hasAny}
      >
        <h2 id="learner-packages-title" style={titleStyle}>
          Пакеты
          {hasAny ? (
            <span style={{ color: 'var(--secondary)', fontWeight: 500 }}>
              {' '}
              ({n})
            </span>
          ) : null}
        </h2>
        {hasAny ? (
          <span aria-hidden="true" style={chevronStyle(collapsed)}>
            ▾
          </span>
        ) : null}
      </button>

      <div id={sectionId} style={contentStyle}>
        {hasAny ? (
          <>
            <ul style={listStyle}>
              {rows.map((r) => (
                <li key={r.purchaseId} style={rowStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontWeight: 600 }}>{r.titleRu}</div>
                    <div style={metaRowStyle}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.countRemaining} из {r.countInitial} {plural(r.countRemaining, 'осталось', 'осталось', 'осталось')}
                      </span>
                      <span> · </span>
                      <span>до {formatRu(r.expiresAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.hasActiveConsumptions ? (
                      <Pill tone="warning">с бронированиями</Pill>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(r.purchaseId, r.titleRu)}
                      disabled={
                        busyId !== null || r.hasActiveConsumptions
                      }
                      aria-describedby={
                        r.hasActiveConsumptions
                          ? `revoke-disabled-${r.purchaseId}`
                          : undefined
                      }
                    >
                      {busyId === r.purchaseId ? 'Отзываем…' : 'Отозвать'}
                    </Button>
                  </div>
                  {r.hasActiveConsumptions ? (
                    <small
                      id={`revoke-disabled-${r.purchaseId}`}
                      style={{
                        gridColumn: '1 / -1',
                        fontSize: 11,
                        color: 'var(--secondary)',
                        marginTop: 4,
                      }}
                    >
                      Сначала отмените забронированные занятия.
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
            {error ? (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              fullWidth
              onClick={onOpenIssueModal}
              disabled={!teacherHasAnyPackage}
            >
              + Выдать пакет
            </Button>
          </>
        ) : (
          <EmptyState
            title="Пакетов пока нет"
            body="Выдайте пакет, чтобы ученик мог записываться на занятия по предоплате."
            action={
              teacherHasAnyPackage ? (
                <Button onClick={onOpenIssueModal}>+ Выдать пакет</Button>
              ) : (
                <Button href="/teacher/packages">Создать пакет →</Button>
              )
            }
          />
        )}
      </div>
      {announcement ? (
        <div role="status" aria-live="polite" style={srOnlyStyle}>
          {announcement}
        </div>
      ) : null}

      <style>{`
        @media (max-width: 639px) {
          .learner-section[data-mobile-collapsed="true"] > div[id="${sectionId}"] {
            display: none;
          }
        }
      `}</style>
    </section>
  )
}

function formatRu(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const cardStyle: CSSProperties = {
  padding: 20,
  background: 'var(--surface-1, #141416)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  marginBottom: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
  color: 'inherit',
}

const titleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  margin: 0,
}

function chevronStyle(collapsed: boolean): CSSProperties {
  return {
    color: 'var(--secondary)',
    fontSize: 14,
    transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
    transition: 'transform 200ms ease-out',
  }
}

const contentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const rowStyle: CSSProperties = {
  padding: 12,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 10,
}

const metaRowStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
}

const errorStyle: CSSProperties = {
  padding: 12,
  background: 'rgba(255,110,110,0.10)',
  border: '1px solid rgba(255,110,110,0.4)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--text)',
}

const srOnlyStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}
