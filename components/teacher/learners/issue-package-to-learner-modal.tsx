'use client'

import { CSSProperties, useEffect, useState } from 'react'

import { Button, Combobox } from '@/components/ui/primitives'

// IssuePackageToLearnerModal — variant of IssuePackageModal mounted
// on the learner-card page. The learner is fixed (the one whose card
// we're viewing); the teacher picks the PACKAGE from a Combobox.
//
// Plan: docs/plans/package-issuance-ux-2026-06-10-v3.md §3.5
// (learner-card variant).
//
// Shares the visual chrome, error mapping, and history-back / 401
// behaviours with IssuePackageModal. We don't deduplicate yet —
// future PR can extract a shared <IssuePackageDialog> hook.

export type IssuePackageOption = {
  id: string
  titleRu: string
  count: number
  durationMinutes: number
  amountKopecks: number
}

export type IssuePackageToLearnerModalProps = {
  open: boolean
  learnerId: string
  learnerLabel: string
  packages: ReadonlyArray<IssuePackageOption>
  onClose: () => void
  onIssued: (result: { packageId: string; pkgTitle: string }) => void
}

export function IssuePackageToLearnerModal({
  open,
  learnerId,
  learnerLabel,
  packages,
  onClose,
  onIssued,
}: IssuePackageToLearnerModalProps) {
  const [packageId, setPackageId] = useState<string | null>(null)
  const [allowStacking, setAllowStacking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPackageId(null)
      setAllowStacking(false)
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
      window.history.pushState({ issueToLearnerOpen: true }, '', window.location.href)
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
    if (!packageId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/teacher/packages/${packageId}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
          allowStacking,
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
      if (res.ok && body?.ok) {
        const picked = packages.find((p) => p.id === packageId)
        onIssued({
          packageId,
          pkgTitle: picked?.titleRu ?? '',
        })
        return
      }
      setError(mapErr(body))
    } catch {
      setError('Нет связи. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const submitDisabled = busy || !packageId

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-to-learner-title"
      style={overlayStyle}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="issue-to-learner-sheet"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 id="issue-to-learner-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Выдать пакет
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
            Получит: <strong style={{ color: 'var(--text)' }}>{learnerLabel}</strong>
          </p>

          {/* Use <div> not <label>: <label> redirects clicks inside it
              to the first focusable child (the Combobox trigger button),
              which re-opens the panel right after we close it on option
              pick. Combobox is custom — no native form-control to
              associate with. */}
          <div style={fieldStyle}>
            <span>Пакет</span>
            <Combobox
              value={packageId}
              onChange={(v) => {
                setPackageId(v)
                if (error) setError(null)
              }}
              options={packages.map((p) => ({
                value: p.id,
                label: `${p.titleRu} · ${p.count} занятий по ${p.durationMinutes} мин`,
                sub: `${(p.amountKopecks / 100).toLocaleString('ru-RU')} ₽`,
              }))}
              placeholder="Выберите пакет"
              emptyMessage="Нет активных пакетов"
              searchable={false}
            />
          </div>

          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={allowStacking}
              onChange={(e) => setAllowStacking(e.target.checked)}
              style={checkboxInputStyle}
            />
            <div>
              <div style={{ fontSize: 14 }}>Разрешить стэкинг с активным пакетом</div>
              <div style={{ fontSize: 12, color: 'var(--secondary)' }}>
                Ученик будет владеть несколькими пакетами одновременно.
              </div>
            </div>
          </label>

          {error ? (
            <div role="alert" aria-live="assertive" style={errorStyle}>
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
            Выдать
          </Button>
        </footer>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .issue-to-learner-sheet {
            border-radius: 16px 16px 0 0 !important;
            margin: auto 0 0 0 !important;
            min-height: 60vh;
          }
        }
      `}</style>
    </div>
  )
}

function mapErr(body: { error?: string; message?: string } | null): string {
  const code = body?.error
  const message = body?.message
  switch (code) {
    case 'package_not_found':
      return message ?? 'Пакет не найден. Обновите страницу.'
    case 'package_inactive':
      return (
        message ??
        'Этот пакет архивирован. Сделайте его активным в каталоге пакетов.'
      )
    case 'already_owns_active_package':
      return (
        message ??
        'У ученика уже есть активный пакет такой же длительности. Включите «Разрешить стэкинг», чтобы выдать ещё один.'
      )
    case 'learner_not_linked':
      return (
        message ??
        'Этот ученик пока не привязан к вам. Откройте список учеников и выпустите инвайт.'
      )
    case 'learner_account_missing':
      return (
        message ??
        'Учётная запись ученика не найдена. Возможно, ученик удалил аккаунт.'
      )
    case 'invalid_learner_account_id':
      return (
        message ??
        'Не получилось определить ученика. Обновите страницу и попробуйте ещё раз.'
      )
    case 'invalid_package_id':
    case 'invalid_body':
      return message ?? 'Что-то пошло не так. Обновите страницу.'
    default:
      return message ?? 'Не получилось выдать пакет. Попробуйте ещё раз.'
  }
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

const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: 12,
  cursor: 'pointer',
  borderRadius: 8,
  border: '1px solid var(--border)',
}

const checkboxInputStyle: CSSProperties = {
  width: 20,
  height: 20,
  accentColor: 'var(--accent)',
  marginTop: 2,
  flexShrink: 0,
}

const errorStyle: CSSProperties = {
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
