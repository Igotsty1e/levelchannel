import type { Figure, Section } from '@/lib/research/types'

import { ResearchFigure } from './ResearchFigure'

/**
 * Editorial section. No icon, no panel/card chrome. Section number
 * + serif H2 + narrative layer-1. Disclosure layers are quiet
 * underlines, not boxes.
 *
 * The key-number / key-caption spans inside layer_1_html become
 * inline emphasis (accent colour, slightly larger serif), not a
 * 52px gradient block.
 */
export function ResearchSection({
  section,
  index,
  accent,
  figures,
}: {
  section: Section
  index: number
  accent: string
  figures: Array<[string, Figure]>
}) {
  const num = String(index).padStart(2, '0')
  return (
    <section className="rs-section" id={section.id} data-accent={accent}>
      <span className="rs-section-num">{num} — Глава</span>
      <h2 className="rs-h2">{section.title}</h2>
      <div
        className="rs-layer-1"
        dangerouslySetInnerHTML={{ __html: section.layer_1_html }}
      />
      <details className="rs-disclosure" open>
        <summary>
          <span className="sign">+</span>
          <span>Подробнее</span>
        </summary>
        <div className="rs-layer-body">
          <div dangerouslySetInnerHTML={{ __html: section.layer_2_html }} />
          {figures.map(([fid, fig]) => (
            <ResearchFigure key={fid} figureId={fid} figure={fig} accent={accent} />
          ))}
        </div>
      </details>
      <details className="rs-disclosure">
        <summary>
          <span className="sign">+</span>
          <span>Для профи</span>
        </summary>
        <div
          className="rs-layer-body"
          dangerouslySetInnerHTML={{ __html: section.layer_3_html }}
        />
      </details>
    </section>
  )
}
