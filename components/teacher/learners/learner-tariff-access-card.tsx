'use client'

import {
  CSSProperties,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'

import { Button, EmptyState } from '@/components/ui/primitives'

import {
  GrantTariffAccessModal,
  type TariffOption,
} from './grant-tariff-access-modal'

// LearnerTariffAccessSection composed with the GrantTariffAccessModal
// singleton. Plan §3.3 — symmetric to LearnerPackagesCard.
//
// Smaller surface: no «with active consumptions» concept, no revoke
// scoping. Just list + close-access + open modal.

export type TariffAccessRow = {
  tariffId: string
  titleRu: string
  amountKopecks: number
  grantedAt: string
}

export type LearnerTariffAccessCardProps = {
  teacherId: string
  learnerId: string
  learnerLabel: string
  rows: ReadonlyArray<TariffAccessRow>
  availableTariffs: ReadonlyArray<TariffOption>
}

export function LearnerTariffAccessCard({
  teacherId,
  learnerId,
  learnerLabel,
  rows,
  availableTariffs,
}: LearnerTariffAccessCardProps) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const focusDebounce = useRef<number | null>(null)

  useEffect(() => {
    function onFocus() {
      if (focusDebounce.current !== null) window.clearTimeout(focusDebounce.current)
      focusDebounce.current = window.setTimeout(() => router.refresh(), 500)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (focusDebounce.current !== null) window.clearTimeout(focusDebounce.current)
    }
  }, [router])

  async function handleCloseAccess(tariffId: string, titleRu: string) {
    if (busyId !== null) return
    setBusyId(tariffId)
    setError(null)
    try {
      const res = await fetch(
        `/api/teacher/tariffs/${tariffId}/access?learnerId=${learnerId}`,
        { method: 'DELETE' },
      )
      if (res.status === 401) {
        const next = encodeURIComponent(window.location.pathname)
        window.location.href = `/login?next=${next}`
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        setError(
          body?.message ??
            'Не получилось закрыть доступ. Попробуйте ещё раз.',
        )
        return
      }
      setCollapsed(false)
      setAnnouncement(`Доступ к тарифу «${titleRu}» закрыт.`)
      window.setTimeout(() => setAnnouncement(null), 4000)
      router.refresh()
    } catch {
      setError('Нет связи. Попробуйте ещё раз.')
    } finally {
      setBusyId(null)
    }
  }

  const n = rows.length
  const hasAny = n > 0
  const dataMobileCollapsed = hasAny && collapsed
  const sectionId = 'learner-tariff-access-content'

  return (
    <>
      <section
        className="learner-section"
        data-mobile-collapsed={dataMobileCollapsed ? 'true' : 'false'}
        style={cardStyle}
        aria-labelledby="learner-tariff-access-title"
      >
        <button
          type="button"
          onClick={() => hasAny && setCollapsed((v) => !v)}
          aria-expanded={!collapsed || !hasAny}
          aria-controls={sectionId}
          style={headerStyle}
          disabled={!hasAny}
        >
          <h2 id="learner-tariff-access-title" style={titleStyle}>
            Доступ к тарифам
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
                  <li key={r.tariffId} style={rowStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{r.titleRu}</div>
                      <div style={metaRowStyle}>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {(r.amountKopecks / 100).toLocaleString('ru-RU')} ₽
                        </span>
                        <span> · </span>
                        <span>с {formatRu(r.grantedAt)}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCloseAccess(r.tariffId, r.titleRu)}
                      disabled={busyId !== null}
                    >
                      {busyId === r.tariffId ? 'Закрываем…' : 'Закрыть доступ'}
                    </Button>
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
                onClick={() => setModalOpen(true)}
                disabled={availableTariffs.length === 0}
              >
                + Открыть доступ к тарифу
              </Button>
            </>
          ) : (
            <EmptyState
              title="Доступов к тарифам пока нет"
              body="Откройте ученику доступ к одному из ваших тарифов, чтобы он мог записаться на занятие по нему."
              action={
                availableTariffs.length > 0 ? (
                  <Button onClick={() => setModalOpen(true)}>
                    + Открыть доступ
                  </Button>
                ) : (
                  <Button href="/teacher/tariffs">Создать тариф →</Button>
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

      <GrantTariffAccessModal
        open={modalOpen}
        learnerId={learnerId}
        learnerLabel={learnerLabel}
        tariffs={availableTariffs}
        onClose={() => setModalOpen(false)}
        onGranted={() => {
          setModalOpen(false)
          router.refresh()
        }}
      />
    </>
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
