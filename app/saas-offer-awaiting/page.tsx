// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — placeholder waiting
// page. Reachable only when SAAS_OFFER_GATE_ENABLED=1 AND the live
// `saas_offer` version label starts with `v0-placeholder-`
// (operator has flipped the gate but not yet published the real v1
// body via /admin/legal).
//
// Routing decisions (per plan-doc round-9 BLOCKER#1 + round-10 WARN#4):
//   - anonymous → /login
//   - learner → /cabinet (wrong role)
//   - admin → /admin/slots
//   - teacher + gate-off → /teacher
//   - teacher + 'ok' verdict → /teacher
//   - teacher + 'consent_required' verdict → /saas-offer-accept
//   - teacher + 'awaiting_publication' verdict → SHOW THIS PAGE
//
// UX: no interactive controls (the teacher can do nothing; the
// operator must publish v1). Meta-refresh every 60s so the page
// recovers without a manual reload once the operator publishes.
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { listAccountRoles } from '@/lib/auth/accounts'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Платформа обновляет SaaS-оферту | LevelChannel',
  robots: { index: false, follow: false },
  // Reload every 60 seconds so a teacher who landed here recovers
  // automatically when admin publishes the real v1.
  other: { refresh: '60' },
}

export default async function SaasOfferAwaitingPage() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!sessionCookie) redirect('/login')

  const current = await lookupSession(sessionCookie)
  if (!current) redirect('/login')

  // Round-2 INFO#3 closure (2026-05-30) — mirror the verified-email
  // gate on the sibling /saas-offer-accept route. An unverified
  // teacher session reaching this page should land on /cabinet to
  // surface the e-mail verification banner, not see a waiting page.
  if (!current.account.emailVerifiedAt) redirect('/cabinet')

  const roles = await listAccountRoles(current.account.id)
  if (roles.includes('admin')) redirect('/admin/slots')
  if (!roles.includes('teacher')) redirect('/cabinet')

  // Re-evaluate the gate verdict; if it is no longer 'awaiting',
  // route the teacher to the right destination instead of letting
  // them sit on this page indefinitely.
  const verdict = await evaluateSaasOfferGate(current.account.id)
  if (verdict.kind === 'ok') redirect('/teacher')
  if (verdict.kind === 'consent_required') redirect('/saas-offer-accept')

  return (
    <main
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '64px 24px',
        color: 'var(--text)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
        Платформа обновляет SaaS-оферту
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 15,
          lineHeight: 1.6,
        }}
      >
        Сейчас идёт публикация новой версии. Страница автоматически
        обновится. Возвращайтесь чуть позже — пока ничего делать не
        нужно.
      </p>
    </main>
  )
}
