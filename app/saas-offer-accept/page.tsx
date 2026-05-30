// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — existing-teacher
// SaaS-оферта acceptance interstitial. Reachable only when
// SAAS_OFFER_GATE_ENABLED=1 AND the teacher's `saas_offer` consent
// FK does not match the current live version id.
//
// Lives as a top-level route (NOT under /teacher/**) so the SSR
// gate in `app/teacher/layout.tsx` doesn't infinite-loop redirect
// the teacher back to the same gate.
//
// Page renders the current `body_md` of `saas_offer`. The hidden
// form field `saasOfferConsentVersionId` carries the live `id` to
// the POST handler, where the TOCTOU check rejects with 409 if a
// new version was published in between (operator publishes v2 while
// the teacher reads v1).
//
// Routing decisions:
//   - anonymous → /login
//   - learner → /cabinet (wrong role)
//   - admin → /admin/slots
//   - teacher with 'ok' verdict → /teacher (already consented)
//   - teacher with 'awaiting_publication' verdict → /saas-offer-awaiting
//   - teacher with 'consent_required' verdict → SHOW THIS PAGE
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { listAccountRoles } from '@/lib/auth/accounts'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { LegalBodyRenderer } from '@/lib/legal/render-body'
import { getCurrentLegalVersion } from '@/lib/legal/versions'

import { SaasOfferAcceptForm } from './accept-form'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Согласие с SaaS-офертой | LevelChannel',
  robots: { index: false, follow: false },
}

export default async function SaasOfferAcceptPage() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!sessionCookie) redirect('/login')

  const current = await lookupSession(sessionCookie)
  if (!current) redirect('/login')

  if (!current.account.emailVerifiedAt) redirect('/cabinet')

  const roles = await listAccountRoles(current.account.id)
  if (roles.includes('admin')) redirect('/admin/slots')
  if (!roles.includes('teacher')) redirect('/cabinet')

  // Re-evaluate the gate so we land the user on the correct page.
  const verdict = await evaluateSaasOfferGate(current.account.id)
  if (verdict.kind === 'ok') redirect('/teacher')
  if (verdict.kind === 'awaiting_publication')
    redirect('/saas-offer-awaiting')

  // 'consent_required' — render the form.
  const live = await getCurrentLegalVersion('saas_offer')
  // Defensive: evaluateSaasOfferGate returned 'consent_required' only
  // if live is non-null + non-placeholder. If we got null here it's a
  // race; redirect to awaiting and let the user retry.
  if (!live || live.versionLabel.startsWith('v0-placeholder-')) {
    redirect('/saas-offer-awaiting')
  }

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '40px 20px',
        color: 'var(--text)',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Согласие с условиями SaaS-оферты
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 14,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        Вы — действующий учитель LevelChannel. Чтобы продолжить пользоваться
        кабинетом, подтвердите согласие с текущей редакцией SaaS-оферты
        (версия <strong>{live.versionLabel}</strong>, действует с{' '}
        {new Date(live.effectiveFrom).toLocaleString('ru-RU')}).
      </p>

      <div
        style={{
          background: 'var(--surface, #111316)',
          border: '1px solid var(--border, #2a2d33)',
          borderRadius: 8,
          padding: '24px 28px',
          marginBottom: 24,
        }}
      >
        <LegalBodyRenderer markdown={live.bodyMd} />
      </div>

      <SaasOfferAcceptForm
        versionId={live.id}
        versionLabel={live.versionLabel}
      />
    </main>
  )
}
