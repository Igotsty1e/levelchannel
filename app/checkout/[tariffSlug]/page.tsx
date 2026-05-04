import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

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

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
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
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            LevelChannel
          </Link>
          <Link
            href="/"
            style={{
              color: 'var(--secondary)',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            ← На главную
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
  )
}
