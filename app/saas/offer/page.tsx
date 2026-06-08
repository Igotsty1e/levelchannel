// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — public SaaS-оферта
// surface. Renders the body of the current `saas_offer` row from
// `legal_document_versions`. Append-only publish model — admin
// publishes new versions via `/admin/legal`; the gate predicate
// (`evaluateSaasOfferGate`) consumes whatever this page renders.
//
// Until owner publishes the legal-rf-signed v1 via admin UI, the
// migration 0096 seed `v0-placeholder-do-not-accept` is the live
// row; the page renders the placeholder body explaining the state.
//
// Launch gate (per plan-doc §3.5): page is `noindex` until Epic 4
// (recurrent self-serve) ships. Crawlers excluded; teacher consent
// gate links to this page, so it must NOT 404 — it renders the
// current live body, whatever that is.
import Link from 'next/link'

import { LegalBodyRenderer } from '@/lib/legal/render-body'
import { getCurrentLegalVersion } from '@/lib/legal/versions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'SaaS-оферта | LevelChannel',
  robots: { index: false, follow: false },
}

export default async function SaasOfferPage() {
  const live = await getCurrentLegalVersion('saas_offer')

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '40px 20px',
        color: 'var(--text)',
      }}
    >
      <p style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/" style={{ color: 'var(--secondary)' }}>
          ← К лендингу LevelChannel
        </Link>
      </p>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
        SaaS-оферта
      </h1>
      {live ? (
        <>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              marginBottom: 24,
              lineHeight: 1.6,
            }}
          >
            Версия <strong>{live.versionLabel}</strong>, действует с{' '}
            {new Date(live.effectiveFrom).toLocaleString('ru-RU')}.
          </p>
          <LegalBodyRenderer markdown={live.bodyMd} />
        </>
      ) : (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            marginTop: 24,
            lineHeight: 1.6,
          }}
        >
          Документ не опубликован. Возвращайтесь чуть позже.
        </p>
      )}
    </main>
  )
}
