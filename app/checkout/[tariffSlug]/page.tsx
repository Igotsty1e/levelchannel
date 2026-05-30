import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Script from 'next/script'

import { BrandMark } from '@/components/brand/brand-mark'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { listAllTariffs } from '@/lib/pricing/tariffs'
import { getSlotById } from '@/lib/scheduling/slots'

import { CheckoutForm } from './checkout-form'

// Phase 6 — tariff-bound checkout. Lives at a separate URL on
// purpose: the existing /pay (free-amount) is bit-for-bit untouched,
// and we soak this new flow in production before deciding whether
// to fold /pay into a tariff picker.
//
// Public surface (no auth required):
//   /checkout/lesson-60min            → pay 3500₽ for "Урок 60 минут"
//   /checkout/lesson-60min?slot=<uuid> → same + bind on webhook paid
//
// 404 on unknown / archived (is_active=false) tariff.
// 404 on malformed slot id; not-found slot is silently dropped (the
// page renders without slot binding so the operator can still send
// a checkout link even if their cabinet is mid-flight).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteProps = {
  params: Promise<{ tariffSlug: string }>
  searchParams: Promise<{ slot?: string }>
}

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const { tariffSlug } = await params
  return {
    title: `Оплата (${tariffSlug}) — LevelChannel`,
    description: 'Оплата индивидуальных занятий по английскому языку.',
    robots: { index: false, follow: false },
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CheckoutPage({
  params,
  searchParams,
}: RouteProps) {
  const { tariffSlug } = await params
  const sp = await searchParams

  // SAAS-PIVOT Epic 2 Day 3 — admin-global lookup. The /checkout/:slug
  // route is the public direct-pay surface; the resolved tariff carries
  // its owning teacher_id which downstream code (payment writer +
  // teacher_earnings ledger in Epic 4/5) will pick up. The slug is
  // still globally unique on Day 3 (composite UNIQUE for tariffs is
  // out of scope per plan §3 Epic 2), so findByActiveSlug is safe.
  // teacher-scope: admin-global — we need every teacher's catalogue to
  // resolve a checkout link sent over WhatsApp/email. Soft-deleted
  // tariffs (deleted_at IS NOT NULL) are excluded by default from
  // listAllTariffs() so an archived link 404s gracefully.
  const tariffs = await listAllTariffs()
  const tariff = tariffs.find(
    (t) => t.slug === tariffSlug && t.isActive,
  )
  if (!tariff) notFound()

  // Optional slot binding. Validates the slot exists; we DON'T assert
  // ownership here on the server because the cabinet-bound flow
  // passes through /api/payments which itself records slotId in
  // metadata, and the webhook writes the allocation only when the
  // slot exists at that point. Soft validation here = nicer error
  // surface, not a security gate.
  const slotId = typeof sp.slot === 'string' && UUID_PATTERN.test(sp.slot) ? sp.slot : null
  const slot = slotId ? await getSlotById(slotId) : null

  // BUG-1 (2026-05-14): logged-in learners on /checkout get a clear path
  // back to cabinet (the most common point of return), instead of always
  // routing them to the public landing. Cookie-presence-only check;
  // /cabinet itself redirects invalid sessions to /login.
  const cookieStore = await cookies()
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  const backHref = hasSession ? '/cabinet' : '/'
  const backLabel = hasSession ? '← В кабинет' : '← На главную'

  return (
    <>
      <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Codex 2026-05-08 (Wave 10 #5) — CloudPayments widget script
          loads here (and on /pay), not globally from layout. */}
      <Script
        src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"
        strategy="beforeInteractive"
      />
      <header
        style={{
          padding: '20px 0',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(11, 11, 12, 0.85)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Link
            href="/"
            style={{
              color: 'var(--text)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            aria-label="LevelChannel — на главную"
          >
            <BrandMark variant="full" width={150} />
          </Link>
          <Link
            href={backHref}
            style={{
              color: 'var(--secondary)',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            {backLabel}
          </Link>
        </div>
      </header>

      <CheckoutForm
        tariffTitle={tariff.titleRu}
        tariffSlug={tariff.slug}
        amountKopecks={tariff.amountKopecks}
        amountRub={tariff.amountKopecks / 100}
        descriptionRu={tariff.descriptionRu}
        slotId={slot?.id ?? null}
        slotStartAt={slot?.startAt ?? null}
        slotDurationMinutes={slot?.durationMinutes ?? null}
      />
      </main>
    </>
  )
}
