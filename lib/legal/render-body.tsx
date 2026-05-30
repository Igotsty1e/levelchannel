// SAAS-OFFER bundle (Sub-A.2-3-5, 2026-05-30) — shared minimal
// markdown renderer for legal-document bodies stored in
// `legal_document_versions.body_md`.
//
// Extracted from `app/legal/v/[id]/page.tsx` so the public render at
// `/saas/offer`, the existing-teacher interstitial at
// `/saas-offer-accept`, and the historical version surface at
// `/legal/v/[id]` all use the same renderer. No markdown library;
// the only constructs needed for legal text are:
//
//   1. paragraphs separated by blank lines,
//   2. **bold** inline,
//   3. # / ## / ### heading lines.
//
// Anything HTML-shaped is passed through React's default escaping
// (no `dangerouslySetInnerHTML`) — operator input never reaches the
// DOM as raw HTML.
import type React from 'react'

export function LegalBodyRenderer({ markdown }: { markdown: string }) {
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
              <h2
                key={i}
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: '28px 0 12px',
                }}
              >
                {text}
              </h2>
            )
          }
          if (level === 2) {
            return (
              <h3
                key={i}
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  margin: '24px 0 10px',
                }}
              >
                {text}
              </h3>
            )
          }
          return (
            <h4
              key={i}
              style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 8px' }}
            >
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
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i}>{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
