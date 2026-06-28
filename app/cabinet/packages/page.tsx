import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import Script from 'next/script'

import { EmptyState, Pill } from '@/components/ui/primitives'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listAccountActivePackages, listActivePackages } from '@/lib/billing/packages'

import { BuyButton } from './buy-button'

// PKG-LEARNER-BUY LBL.1 — learner-facing package catalog with buy CTA.
//
// Canonical cabinet SSR auth pattern (per app/cabinet/page.tsx:48-59):
// read session cookie directly, redirect('/login') if missing. After
// session resolved, gate by `isLearnerArchetypeCandidate` — same
// SoT predicate used by /api/checkout/package/[slug] (LBL.0) so the
// page and the API agree on "can this account buy a package?". Non-
// learner sessions bounce to /cabinet (admins live on /admin, teachers
// on cabinet teacher section).
//
// Widget script is loaded at page level (NOT app/layout.tsx) per Codex
// 2026-05-08 Wave 10 #5. The widget bundle URL must end in `.js`.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Пакеты — LevelChannel',
}

function formatRub(amountKopecks: number): string {
  const rub = amountKopecks / 100
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rub)
}

export default async function CabinetPackagesPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')

  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  const { account } = current

  const canBuy = await isLearnerArchetypeCandidate(account.id)
  if (!canBuy) redirect('/cabinet')

  // T3 Sub-PR E (2026-06-02) — learner-side visibility filter.
  // Pass viewer's account id so private packages where this learner
  // has an active `learner_package_access` row are included; private
  // packages without an active grant are hidden.
  const [catalog, owned] = await Promise.all([
    listActivePackages(account.id),
    listAccountActivePackages(account.id),
  ])

  return (
    <>
      {/* 2026-06-25 a11y: <main> убран — app/cabinet/layout.tsx уже даёт <main>. */}
      <div
        className="saas-chrome"
        style={{ minHeight: '100vh', background: 'var(--bg)' }}
      >
      <Script
        src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"
        strategy="beforeInteractive"
      />
      <div className="container" style={{ padding: '32px 0 64px', maxWidth: 1200 }}>
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            textDecoration: 'none',
            marginBottom: 24,
            display: 'inline-block',
          }}
        >
          ← В кабинет
        </Link>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: '8px 0 8px',
            color: 'var(--text)',
          }}
        >
          Пакеты занятий
        </h1>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            marginBottom: 32,
            maxWidth: 640,
          }}
        >
          Пакет — это несколько занятий одной длительности по сниженной
          цене. Срок действия — 6 месяцев с момента покупки. При каждой
          записи на занятие нужной длительности списывается одно занятие
          из пакета.
        </p>

        {owned.length > 0 ? (
          <section style={{ marginBottom: 40 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--secondary)',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 12,
              }}
            >
              У вас активны
            </h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 8,
              }}
            >
              {owned.map((p) => (
                <li
                  key={p.id}
                  style={{
                    padding: '10px 14px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 13,
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <b>{p.titleSnapshot}</b>
                  <Pill tone="success" size="sm">
                    {p.countRemaining} из {p.countInitial}
                  </Pill>
                  <span style={{ color: 'var(--secondary)' }}>
                    {p.durationMinutes} мин · действителен до{' '}
                    {new Date(p.expiresAt).toLocaleDateString('ru-RU')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--secondary)',
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              marginBottom: 12,
            }}
          >
            Каталог
          </h2>
          {catalog.length === 0 ? (
            <EmptyState
              title="Пакетов сейчас нет в продаже"
              body="Загляните позже — мы добавим новые варианты."
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              }}
            >
              {catalog.map((pkg) => (
                <article
                  key={pkg.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 20,
                    background: 'var(--card-bg, transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <header>
                    <h3
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        margin: '0 0 6px',
                        color: 'var(--text)',
                      }}
                    >
                      {pkg.titleRu}
                    </h3>
                    <div
                      style={{
                        color: 'var(--secondary)',
                        fontSize: 12,
                      }}
                    >
                      {pkg.count} занятий · {pkg.durationMinutes} мин каждое
                    </div>
                  </header>
                  {pkg.descriptionRu ? (
                    <p
                      style={{
                        color: 'var(--secondary)',
                        fontSize: 13,
                        lineHeight: 1.5,
                        margin: 0,
                      }}
                    >
                      {pkg.descriptionRu}
                    </p>
                  ) : null}
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: 'var(--text)',
                    }}
                  >
                    {formatRub(pkg.amountKopecks)}
                  </div>
                  <BuyButton
                    slug={pkg.slug}
                    titleRu={pkg.titleRu}
                    amountRub={pkg.amountKopecks / 100}
                    packageId={pkg.id}
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      </div>
    </>
  )
}
