'use client'

import { CSSProperties, useEffect, useState } from 'react'

import { Button, Combobox } from '@/components/ui/primitives'

// GrantTariffAccessModal — learner-card variant for opening tariff
// access. Learner fixed, teacher picks tariff from Combobox.
//
// Plan: docs/plans/package-issuance-ux-2026-06-10-v3.md §3.6.

export type TariffOption = {
  id: string
  titleRu: string
  amountKopecks: number
  durationMinutes: number
}

export type GrantTariffAccessModalProps = {
  open: boolean
  learnerId: string
  learnerLabel: string
  tariffs: ReadonlyArray<TariffOption>
  onClose: () => void
  onGranted: (result: { tariffId: string; tariffTitle: string }) => void
}

export function GrantTariffAccessModal({
  open,
  learnerId,
  learnerLabel,
  tariffs,
  onClose,
  onGranted,
}: GrantTariffAccessModalProps) {
  const [tariffId, setTariffId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTariffId(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  useEffect(() => {
    if (!open) return
    try {
      window.history.pushState({ grantTariffOpen: true }, '', window.location.href)
    } catch {
      // ignore
    }
    function onPop() {
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open, onClose])

  async function handleSubmit() {
    if (!tariffId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/teacher/tariffs/${tariffId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
        }),
      })
      if (res.status === 401) {
        const next = encodeURIComponent(window.location.pathname)
        window.location.href = `/login?next=${next}`
        return
      }
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string }
        | null
      if (res.ok && body?.ok !== false) {
        const picked = tariffs.find((t) => t.id === tariffId)
        onGranted({
          tariffId,
          tariffTitle: picked?.titleRu ?? '',
        })
        return
      }
      setError(body?.message ?? body?.error ?? 'Не получилось открыть доступ.')
    } catch {
      setError('Нет связи. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const submitDisabled = busy || !tariffId

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="grant-tariff-title"
      style={overlayStyle}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="grant-tariff-sheet"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 id="grant-tariff-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Открыть доступ к тарифу
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={busy}
            style={closeBtnStyle}
          >
            ×
          </button>
        </header>

        <div style={bodyStyle}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--secondary)' }}>
            Доступ получит:{' '}
            <strong style={{ color: 'var(--text)' }}>{learnerLabel}</strong>
          </p>

          <label style={fieldStyle}>
            Тариф
            <Combobox
              value={tariffId}
              onChange={(v) => {
                setTariffId(v)
                if (error) setError(null)
              }}
              options={tariffs.map((t) => ({
                value: t.id,
                label: `${t.titleRu} · ${t.durationMinutes} мин`,
                sub: `${(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽`,
              }))}
              placeholder="Выберите тариф"
              emptyMessage="Нет активных тарифов"
              searchable={false}
            />
          </label>

          {error ? (
            <div role="alert" aria-live="assertive" style={errorBannerStyle}>
              {error}
            </div>
          ) : null}
        </div>

        <footer style={footerStyle}>
          <Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={handleSubmit}
            loading={busy}
            disabled={submitDisabled}
          >
            Открыть доступ
          </Button>
        </footer>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .grant-tariff-sheet {
            border-radius: 16px 16px 0 0 !important;
            margin: auto 0 0 0 !important;
            min-height: 50vh;
          }
        }
      `}</style>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const sheetStyle: CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  maxWidth: 520,
  width: '100%',
  maxHeight: '92vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid var(--border)',
}

const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text)',
  fontSize: 24,
  cursor: 'pointer',
  padding: '0 8px',
  minWidth: 44,
  minHeight: 44,
}

const bodyStyle: CSSProperties = {
  padding: 16,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  flex: 1,
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: 'var(--secondary)',
}

const errorBannerStyle: CSSProperties = {
  padding: 12,
  background: 'rgba(255,110,110,0.10)',
  border: '1px solid rgba(255,110,110,0.4)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
}

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 16,
  borderTop: '1px solid var(--border)',
  position: 'sticky',
  bottom: 0,
  background: 'var(--bg)',
}
