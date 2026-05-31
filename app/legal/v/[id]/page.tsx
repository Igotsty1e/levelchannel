import Link from 'next/link'
import { notFound } from 'next/navigation'

import { LegalBodyRenderer } from '@/lib/legal/render-body'
import { getLegalVersionById } from '@/lib/legal/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KIND_LABEL: Record<string, string> = {
  offer: 'Публичная оферта',
  privacy: 'Политика обработки персональных данных',
  personal_data: 'Согласие на обработку персональных данных',
  saas_offer: 'SaaS-оферта',
  saas_processor_terms: 'Приложение № 1 — Условия поручения оператора учителю',
}
const KIND_LIVE_PATH: Record<string, string> = {
  offer: '/offer',
  privacy: '/privacy',
  personal_data: '/consent/personal-data',
  saas_offer: '/saas/offer',
  saas_processor_terms: '/saas/processor-terms',
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

// Wave 19. public history surface for a specific legal version.
//
// URL: /legal/v/<uuid>
//
// Renders the snapshot body verbatim (markdown rendered as plain
// paragraphs split by blank lines plus minimal **bold** support).
// This is the document the user agreed to. it must be reproducible
// regardless of what's currently live on /offer or /privacy. Powers
// dispute / audit lookup ("which terms applied to me on day X?").

export async function generateMetadata({ params }: RouteParams) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) return { title: 'Документ не найден' }
  const v = await getLegalVersionById(id)
  if (!v) return { title: 'Документ не найден' }
  return {
    title: `${KIND_LABEL[v.docKind] ?? v.docKind} ${v.versionLabel} | LevelChannel`,
  }
}

export default async function LegalVersionPage({ params }: RouteParams) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()
  const version = await getLegalVersionById(id)
  if (!version) notFound()

  const docLabel = KIND_LABEL[version.docKind] ?? version.docKind
  const livePath = KIND_LIVE_PATH[version.docKind]

  return (
    <>
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
          ← На главную
        </Link>
      </p>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
        {docLabel}
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 6,
          lineHeight: 1.6,
        }}
      >
        Версия <strong>{version.versionLabel}</strong>, действует с{' '}
        {new Date(version.effectiveFrom).toLocaleString('ru-RU')}.{' '}
        {livePath ? (
          <>
            Текущая версия документа доступна по адресу{' '}
            <Link href={livePath} style={{ color: 'var(--accent, #6ea8fe)' }}>
              {livePath}
            </Link>
            .
          </>
        ) : null}
      </p>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          marginBottom: 24,
        }}
      >
        Version ID: {version.id}
      </p>

      <LegalBodyRenderer markdown={version.bodyMd} />
      </main>
    </>
  )
}
