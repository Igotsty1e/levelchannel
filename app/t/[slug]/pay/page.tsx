import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Script from 'next/script'

import { BrandMark } from '@/components/brand/brand-mark'
import { PricingSection } from '@/components/payments/pricing-section'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

// SAAS-PIVOT Epic 6 Day 6 (2026-05-22) — `/t/<teacher-slug>/pay` —
// public direct-pay surface for plan-4 teachers.
//
// Plan: docs/plans/saas-pivot-master.md §2.8 + §3 Epic 6 + §5 Day 6.
//
// Resolution flow:
//   1. Look up account_id by account_profiles.teacher_public_slug.
//   2. Verify the account has the `teacher` role.
//   3. Verify the account's teacher_subscriptions plan is
//      'operator-managed' (Plan-4). Free/Mid/Pro tiers handle billing
//      off-platform; routing money through the platform for them
//      would orphan the funds.
//   4. On any miss → 404. Uniform shape (no PII leak): "учитель не
//      найден" so a probe can't enumerate slugs.
//
// On success, render the same `<PricingSection />` as the canonical
// /pay page. The /api/payments writer derives teacher_account_id from
// `?t=<slug>` URL parameter, so we pass the slug through query string.

export const metadata: Metadata = {
  title: 'Оплата — LevelChannel',
  description: 'Оплата занятий по английскому языку.',
  robots: {
    index: false,
    follow: false,
  },
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,30}$/

type ResolvedTeacher = {
  accountId: string
  publicSlug: string
}

async function resolvePlan4Teacher(
  slug: string,
): Promise<ResolvedTeacher | null> {
  if (!SLUG_PATTERN.test(slug)) return null
  const pool = getDbPool()
  // Single join: account → profile (teacher_public_slug) → subscription
  // (plan-4). All three gates must pass; any miss → null. The query
  // intentionally does NOT leak which gate failed; the caller surfaces
  // a uniform 404.
  const result = await pool.query<{ account_id: string }>(
    `select a.id as account_id
       from accounts a
       join account_profiles p on p.account_id = a.id
       join teacher_subscriptions s on s.account_id = a.id
      where p.teacher_public_slug = $1
        and s.plan_slug = 'operator-managed'
        and s.state = 'active'
      limit 1`,
    [slug],
  )
  const accountId = result.rows[0]?.account_id
  if (!accountId) return null
  // Anti-spoof: verify the `teacher` role grant. account_roles is the
  // canonical role assignment table — a Plan-4 sub without a teacher
  // role is a misconfiguration; we treat it as not-found.
  const roles = await listAccountRoles(String(accountId))
  if (!roles.includes('teacher')) return null
  return { accountId: String(accountId), publicSlug: slug }
}

export default async function TeacherPayPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const teacher = await resolvePlan4Teacher(slug)
  if (!teacher) {
    // Uniform 404 — no information leak about which gate failed.
    notFound()
  }

  const cookieStore = await cookies()
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  const backHref = hasSession ? '/cabinet' : '/'
  const backLabel = hasSession ? '← В кабинет' : '← На главную'

  return (
    <>
      <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <Script
          src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"
          strategy="beforeInteractive"
        />
        <header
          style={{
            padding: '20px 0',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
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
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                fontSize: 13,
              }}
            >
              {backLabel}
            </Link>
          </div>
        </header>

        {/* Pass the slug down to the pricing section so the POST to
            /api/payments carries `?t=<slug>` and the writer derives
            teacher_account_id from it. */}
        <PricingSection teacherSlug={teacher.publicSlug} />
      </main>
    </>
  )
}
