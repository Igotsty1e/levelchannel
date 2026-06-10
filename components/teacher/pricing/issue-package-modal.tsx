'use client'

import { CSSProperties, useEffect, useRef, useState } from 'react'

import { Button, Combobox } from '@/components/ui/primitives'

// IssuePackageModal — singleton modal on the catalog and learner-card
// pages. Wired by the host page; mounted once, opened with
// `openWith(packageId, learnerId?)`.
//
// Plan: docs/plans/package-issuance-ux-2026-06-10-v3.md §3.5.
//
// Discriminated-union result handling (R22-1) is on the server-reply
// side; we map { error: 'xxx' } codes onto user-facing Banner text
// inside the modal.
//
// Visual chrome mirrors BulkAddSlotsModal so the UX is consistent:
// centered modal ≥640px, bottom-sheet <640px. Submit row is sticky
// at the bottom of the sheet so the iOS keyboard doesn't hide it
// (M-R3-2).

export type IssuePackageModalPackage = {
  id: string
  titleRu: string
}

export type IssuePackageModalLearner = {
  id: string
  label: string
}

export type IssuePackageModalProps = {
  open: boolean
  pkg: IssuePackageModalPackage | null
  learners: ReadonlyArray<IssuePackageModalLearner>
  preselectLearnerId?: string | null
  onClose: () => void
  /** Called after a 200 reply; parent triggers router.refresh(). */
  onIssued: (result: { learnerId: string; learnerLabel: string; pkgTitle: string }) => void
}

type FailureReason =
  | 'package_not_found'
  | 'package_inactive'
  | 'already_owns_active_package'
  | 'learner_not_linked'
  | 'learner_account_missing'
  | 'network_error'
  | 'session_expired'
  | 'unknown'

type ServerError = {
  reason: FailureReason
  message: string
  ctaHref?: string
  ctaLabel?: string
}

export function IssuePackageModal({
  open,
  pkg,
  learners,
  preselectLearnerId,
  onClose,
  onIssued,
}: IssuePackageModalProps) {
  const [learnerId, setLearnerId] = useState<string | null>(null)
  const [allowStacking, setAllowStacking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ServerError | null>(null)

  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // sync preselect when modal opens with a new package
  useEffect(() => {
    if (open) {
      setLearnerId(preselectLearnerId ?? null)
      setAllowStacking(false)
      setError(null)
    }
  }, [open, pkg?.id, preselectLearnerId])

  // ESC to close (only when no inner picker is grabbing it)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  // history-back protection (R19-1): push a placeholder so the
  // system back gesture closes the modal first.
  useEffect(() => {
    if (!open) return
    try {
      window.history.pushState({ issueModalOpen: true }, '', window.location.href)
    } catch {
      // ignore
    }
    function onPop() {
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [open, onClose])

  async function handleSubmit() {
    if (!pkg) return
    if (!learnerId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/teacher/packages/${pkg.id}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
          allowStacking,
        }),
      })
      if (res.status === 401) {
        // session expired — bounce to login with return path
        const next = encodeURIComponent(window.location.pathname)
        window.location.href = `/login?next=${next}`
        return
      }
      const body = (await res.json().catch(() => null)) as
        | {
            ok?: boolean
            error?: string
            message?: string
          }
        | null
      if (res.ok && body?.ok) {
        const picked = learners.find((l) => l.id === learnerId)
        onIssued({
          learnerId,
          learnerLabel: picked?.label ?? '',
          pkgTitle: pkg.titleRu,
        })
        return
      }
      setError(mapServerError(res.status, body))
    } catch {
      setError({
        reason: 'network_error',
        message: 'Нет связи. Попробуйте ещё раз.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open || !pkg) return null

  const submitDisabled = busy || !learnerId

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-pkg-title"
      style={overlayStyle}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="issue-pkg-sheet"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 id="issue-pkg-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Выдать «{pkg.titleRu}»
          </h2>
          <button
            ref={closeButtonRef}
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
          {/* <div> not <label>: <label> redirects clicks to the first
              focusable child (the Combobox trigger), reopening the
              panel right after we close it on option pick. */}
          <div style={fieldStyle}>
            <span>Ученик</span>
            <Combobox
              value={learnerId}
              onChange={(v) => {
                setLearnerId(v)
                if (error) setError(null)
              }}
              options={learners.map((l) => ({ value: l.id, label: l.label }))}
              placeholder="Выберите ученика"
              emptyMessage="Никого не найдено"
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
            <div role="alert" aria-live="assertive" style={errorBannerStyle}>
              <div style={{ marginBottom: error.ctaHref ? 8 : 0 }}>{error.message}</div>
              {error.ctaHref ? (
                <Button href={error.ctaHref} variant="secondary" size="sm">
                  {error.ctaLabel ?? 'Открыть'}
                </Button>
              ) : null}
              {error.reason === 'network_error' ? (
                <div style={{ marginTop: 8 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSubmit}
                  >
                    Попробовать ещё раз
                  </Button>
                </div>
              ) : null}
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
          .issue-pkg-sheet {
            border-radius: 16px 16px 0 0 !important;
            margin: auto 0 0 0 !important;
            min-height: 60vh;
          }
        }
      `}</style>
    </div>
  )
}

function mapServerError(
  status: number,
  body: { error?: string; message?: string } | null,
): ServerError {
  const code = body?.error ?? ''
  const message = body?.message
  switch (code) {
    case 'package_not_found':
      return {
        reason: 'package_not_found',
        message: message ?? 'Пакет не найден или удалён. Обновите страницу.',
      }
    case 'package_inactive':
      return {
        reason: 'package_inactive',
        message:
          message ?? 'Этот пакет архивирован. Активируйте его в каталоге.',
      }
    case 'already_owns_active_package':
      return {
        reason: 'already_owns_active_package',
        message:
          message ??
          'У ученика уже есть активный пакет такой же длительности. Включите «Разрешить стэкинг», чтобы выдать ещё один.',
      }
    case 'learner_not_linked':
      return {
        reason: 'learner_not_linked',
        message: message ?? 'Этот ученик не привязан к вам.',
        ctaHref: '/teacher/learners',
        ctaLabel: 'Открыть список учеников →',
      }
    case 'learner_account_missing':
      return {
        reason: 'learner_account_missing',
        message: message ?? 'Учётная запись ученика не найдена.',
      }
    default:
      return {
        reason: status >= 500 ? 'unknown' : 'unknown',
        message: message ?? 'Не получилось выдать пакет. Попробуйте ещё раз.',
      }
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
