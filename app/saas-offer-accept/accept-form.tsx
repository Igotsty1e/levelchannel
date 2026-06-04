'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — client form for the
// SaaS-оферта acceptance interstitial. Hidden version-id pinning
// implements the round-10 BLOCKER#1 closure (version-TOCTOU): the
// POST handler asserts the submitted id matches the LIVE id; if
// admin published a new version while the user was reading, the
// server returns 409 `saas_offer_version_changed` and the page
// reloads so the user can read + accept the new body.

type Props = {
  versionId: string
  versionLabel: string
  // §0af Closure for BLOCKER #4 (Sub-A.5 two-document TOCTOU): pin
  // BOTH the saas_offer AND saas_processor_terms version IDs at form
  // render. The POST handler asserts both ids match live values.
  processorTermsVersionId: string
  processorTermsVersionLabel: string
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string; reload?: boolean }
  | { kind: 'success' }

export function SaasOfferAcceptForm({
  versionId,
  versionLabel,
  processorTermsVersionId,
  processorTermsVersionLabel,
}: Props) {
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!agreed || pending) return
    startTransition(async () => {
      try {
        const res = await fetch('/api/teacher/saas-offer-accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            saasOfferConsentVersionId: versionId,
            saasProcessorTermsConsentVersionId: processorTermsVersionId,
          }),
        })
        if (res.ok) {
          setState({ kind: 'success' })
          router.replace('/teacher')
          router.refresh()
          return
        }
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        if (res.status === 409 && body?.error === 'saas_offer_version_changed') {
          setState({
            kind: 'error',
            message:
              'Оферта обновилась. Сейчас перезагрузим страницу — прочитайте новую версию и подтвердите ещё раз.',
            reload: true,
          })
          // Reload after a brief moment so the user reads the banner.
          setTimeout(() => {
            router.refresh()
          }, 1200)
          return
        }
        setState({
          kind: 'error',
          message:
            body?.message ??
            body?.error ??
            'Не удалось подтвердить. Попробуйте ещё раз.',
        })
      } catch {
        setState({
          kind: 'error',
          message: 'Сетевая ошибка. Проверьте соединение и попробуйте ещё раз.',
        })
      }
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="saasOfferConsentVersionId" value={versionId} />
      <input
        type="hidden"
        name="saasProcessorTermsConsentVersionId"
        value={processorTermsVersionId}
      />
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 16,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>
          Я согласен(на) с условиями SaaS-оферты LevelChannel (версия{' '}
          <strong>{versionLabel}</strong>) и Приложения № 1 «Условия
          поручения оператору» (версия{' '}
          <strong>{processorTermsVersionLabel}</strong>).
        </span>
      </label>

      {state.kind === 'error' ? (
        <p
          role="alert"
          style={{
            color: 'var(--danger, #e07676)',
            fontSize: 13,
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!agreed || pending}
        style={{
          background:
            !agreed || pending ? 'var(--surface, #1a1d22)' : 'var(--accent, #6ea8fe)',
          color: !agreed || pending ? 'var(--secondary)' : '#0a0c10',
          border: 'none',
          borderRadius: 8,
          padding: '10px 22px',
          fontSize: 14,
          fontWeight: 600,
          cursor: !agreed || pending ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? 'Подтверждаем…' : 'Подтвердить'}
      </button>
    </form>
  )
}
