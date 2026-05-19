import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getLegalVersionById } from '@/lib/legal/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KIND_LABEL: Record<string, string> = {
  offer: 'Публичная оферта',
  privacy: 'Политика обработки персональных данных',
  personal_data: 'Согласие на обработку персональных данных',
}
const KIND_LIVE_PATH: Record<string, string> = {
  offer: '/offer',
  privacy: '/privacy',
  personal_data: '/consent/personal-data',
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
      {/* SAAS-6-A11Y-1 (2026-05-19) — skip-to-content link for the
          legal viewer's bespoke shell. WCAG 2.4.1. */}
      <a href="#main-content" className="skip-to-content">
        Перейти к основному содержимому
      </a>
      <main
        id="main-content"
        tabIndex={-1}
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

      <BodyRenderer markdown={version.bodyMd} />
      </main>
    </>
  )
}

function BodyRenderer({ markdown }: { markdown: string }) {
  // Minimal-safe renderer. We do NOT pull in a markdown library. for
  // legal text the only constructs we need are:
  //   1. paragraphs separated by blank lines,
  //   2. **bold** inline,
  //   3. # / ## / ### heading lines.
  // Everything else passes as escaped text. Anything HTML-shaped
  // gets escaped (no XSS surface from operator input).
  const blocks = markdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  return (
    <article
      style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text)' }}
    >
      {blocks.map((block, i) => {
        const headingMatch = /^(#{1,3})\s+(.+)$/.exec(block)
        if (headingMatch) {
          const level = headingMatch[1].length
          const text = headingMatch[2]
          if (level === 1) {
            return (
              <h2 key={i} style={{ fontSize: 22, fontWeight: 700, margin: '28px 0 12px' }}>
                {text}
              </h2>
            )
          }
          if (level === 2) {
            return (
              <h3 key={i} style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 10px' }}>
                {text}
              </h3>
            )
          }
          return (
            <h4 key={i} style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 8px' }}>
              {text}
            </h4>
          )
        }
        return (
          <p key={i} style={{ margin: '12px 0' }}>
            {renderInline(block)}
          </p>
        )
      })}
    </article>
  )
}

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** markers; preserve everything else as plain
  // text. The split keeps the captured groups; even-indexed parts
  // are literal, odd-indexed are bolded.
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>,
  )
}
