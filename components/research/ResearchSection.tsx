import type { Figure, Section } from '@/lib/research/types'

import { ResearchFigure } from './ResearchFigure'

const ICONS: Record<string, React.ReactNode> = {
  'trend-up': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  ),
  'trend-down': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <polyline points="3 7 9 13 13 9 21 17" />
      <polyline points="14 17 21 17 21 10" />
    </svg>
  ),
  brain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v15A2.5 2.5 0 0 0 9.5 22h.5v-2H9.5a.5.5 0 0 1-.5-.5v-15a.5.5 0 0 1 .5-.5h.5V2z" />
      <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v15a2.5 2.5 0 0 1-2.5 2.5H14v-2h.5a.5.5 0 0 0 .5-.5v-15a.5.5 0 0 0-.5-.5H14V2z" />
      <line x1="12" y1="6" x2="12" y2="18" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  platform: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  ),
  school: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M22 9 12 4 2 9l10 5 10-5z" />
      <path d="M6 11v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  telescope: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M3 14h7" />
      <path d="M14 4l6 3-7 12-6-3z" />
      <path d="M9 19l-3 3" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
}

export function ResearchSection({
  section,
  accent,
  figures,
}: {
  section: Section
  accent: string
  figures: Array<[string, Figure]>
}) {
  const icon = ICONS[section.icon ?? 'doc'] ?? ICONS.doc
  return (
    <section className="rs-section" id={section.id} data-accent={accent}>
      <header className="rs-section-head">
        <span className="rs-section-icon">{icon}</span>
        <h2>{section.title}</h2>
      </header>
      <div
        className="rs-layer rs-layer-1"
        dangerouslySetInnerHTML={{ __html: section.layer_1_html }}
      />
      <details className="rs-layer-disclosure" open>
        <summary>
          <span>Подробнее</span>
        </summary>
        <div className="rs-layer rs-layer-body">
          <div dangerouslySetInnerHTML={{ __html: section.layer_2_html }} />
          {figures.map(([fid, fig]) => (
            <ResearchFigure key={fid} figureId={fid} figure={fig} />
          ))}
        </div>
      </details>
      <details className="rs-layer-disclosure">
        <summary>
          <span>Для профи</span>
        </summary>
        <div
          className="rs-layer rs-layer-body"
          dangerouslySetInnerHTML={{ __html: section.layer_3_html }}
        />
      </details>
    </section>
  )
}
