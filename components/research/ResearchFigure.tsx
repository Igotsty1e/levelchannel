import type {
  AccentName,
  Figure,
  FigureBarItem,
  FigureCompareItem,
  FigureMetricItem,
  FigurePullQuoteData,
  FigureTimelineItem,
} from '@/lib/research/types'

/**
 * Server-rendered inline SVG charts for the research blog.
 * Mirrors the Python generators in levelchannel-research's
 * lib/render/html.py — same numeric output, React JSX form.
 *
 * Eight chart kinds: hbar / columns / donut / timeline / sparkline /
 * metric-strip / compare-pies / pull-quote. Each accepts an accent
 * name; the gradient ids are uniqued per accent via `_gradId()`.
 *
 * All numbers come from the upstream figures.json. We do NOT
 * recalculate values; we only render.
 */

const ACCENT_COLOURS: Record<AccentName, { start: string; end: string; solid: string }> = {
  rose: { start: '#C87878', end: '#E8A890', solid: '#D88A82' },
  coral: { start: '#E08D6E', end: '#F3B295', solid: '#EF9F82' },
  peach: { start: '#E7B47C', end: '#F5CFA5', solid: '#EFC093' },
  'warm-amber': { start: '#D9A75E', end: '#EBC07A', solid: '#E2B266' },
  info: { start: '#7AB8FF', end: '#9FC3F2', solid: '#8DBDF6' },
  success: { start: '#6BCB89', end: '#8BD9A5', solid: '#7BD297' },
  warning: { start: '#F5C26B', end: '#F5CC7E', solid: '#F5C775' },
  danger: { start: '#FF6E6E', end: '#F08989', solid: '#F77B7B' },
}

const SURFACE_3 = '#26262A'
const TEXT_PRIMARY = '#F5F5F7'
const TEXT_TERTIARY = '#8E8E93'

function gradId(accent: AccentName, suffix = ''): string {
  return `rs-grad-${accent.replace('-', '')}${suffix ? '-' + suffix : ''}`
}

function GradientDefs({ accent }: { accent: AccentName }) {
  const col = ACCENT_COLOURS[accent]
  return (
    <defs>
      <linearGradient id={gradId(accent)} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor={col.start} />
        <stop offset="100%" stopColor={col.end} />
      </linearGradient>
      <linearGradient id={gradId(accent, 'h')} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor={col.start} />
        <stop offset="100%" stopColor={col.end} />
      </linearGradient>
    </defs>
  )
}

function HBarChart({
  data,
  accent,
  unit,
}: {
  data: FigureBarItem[]
  accent: AccentName
  unit?: string
}) {
  if (!data.length) return null
  const width = 640
  const rowHeight = 38
  const pad = 8
  const labelW = 200
  const valueW = 80
  const plotW = width - labelW - valueW
  const maxV = Math.max(...data.map((d) => d.value))
  const height = data.length * rowHeight + pad * 2
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      className="rs-chart"
      role="img"
    >
      <GradientDefs accent={accent} />
      {data.map((d, i) => {
        const y = pad + i * rowHeight + 8
        const barW = ((d.value || 0) / (maxV || 1)) * plotW
        const fill = d.highlight ? `url(#${gradId(accent, 'h')})` : SURFACE_3
        return (
          <g key={`${d.label}-${i}`}>
            <text
              x={labelW - 12}
              y={y + 14}
              textAnchor="end"
              fontSize="13"
              fill={TEXT_PRIMARY}
            >
              {d.label}
            </text>
            <rect
              x={labelW}
              y={y}
              width={barW}
              height={20}
              rx={6}
              fill={fill}
            />
            <text
              x={labelW + barW + 8}
              y={y + 14}
              textAnchor="start"
              fontSize="12"
              fontWeight="600"
              fill={TEXT_PRIMARY}
            >
              {d.value}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function ColumnsChart({
  data,
  accent,
  unit,
}: {
  data: FigureBarItem[]
  accent: AccentName
  unit?: string
}) {
  if (!data.length) return null
  const width = 640
  const height = 280
  const pad = 36
  const plotH = height - pad * 2
  const colSpace = (width - pad * 2) / data.length
  const colW = Math.min(colSpace * 0.6, 56)
  const maxV = Math.max(...data.map((d) => d.value))
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      className="rs-chart"
      role="img"
    >
      <GradientDefs accent={accent} />
      {data.map((d, i) => {
        const x = pad + i * colSpace + (colSpace - colW) / 2
        const h = ((d.value || 0) / (maxV || 1)) * plotH
        const y = height - pad - h
        const fill = d.highlight ? `url(#${gradId(accent)})` : SURFACE_3
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={colW} height={h} rx={6} fill={fill} />
            <text
              x={x + colW / 2}
              y={height - pad + 18}
              textAnchor="middle"
              fontSize="12"
              fill={TEXT_TERTIARY}
            >
              {d.label}
            </text>
            <text
              x={x + colW / 2}
              y={y - 8}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill={TEXT_PRIMARY}
            >
              {d.value}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function DonutChart({
  percent,
  label,
  accent,
  size = 160,
}: {
  percent: number
  label?: string
  accent: AccentName
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 10
  const circumference = 2 * Math.PI * r
  const stroke = (Math.max(0, Math.min(100, percent)) / 100) * circumference
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      className="rs-chart"
      role="img"
      style={{ maxWidth: size }}
    >
      <GradientDefs accent={accent} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={SURFACE_3} strokeWidth="14" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={`url(#${gradId(accent)})`}
        strokeWidth="14"
        strokeDasharray={`${stroke} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        fontSize={size > 140 ? '26' : '20'}
        fontWeight="700"
        fill={TEXT_PRIMARY}
      >
        {percent}%
      </text>
      {label ? (
        <text
          x={cx}
          y={cy + size / 4}
          textAnchor="middle"
          fontSize="11"
          fill={TEXT_TERTIARY}
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}

function TimelineChart({
  events,
  accent,
}: {
  events: FigureTimelineItem[]
  accent: AccentName
}) {
  if (!events.length) return null
  const width = 720
  const height = 220
  const pad = 40
  const lineY = height / 2
  const plotW = width - pad * 2
  const solid = ACCENT_COLOURS[accent].solid
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      className="rs-chart"
      role="img"
    >
      <GradientDefs accent={accent} />
      <line
        x1={pad}
        y1={lineY}
        x2={width - pad}
        y2={lineY}
        stroke={`url(#${gradId(accent, 'h')})`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {events.map((e, i) => {
        const x = pad + (i + 0.5) * (plotW / events.length)
        const above = i % 2 === 0
        const baseY = above ? lineY - 24 : lineY + 36
        const dateY = above ? lineY - 8 : lineY + 20
        const isHypothesis = e.kind === 'hypothesis'
        const words = e.event.split(/\s+/)
        const lines: string[] = []
        let cur = ''
        for (const w of words) {
          const cand = (cur + ' ' + w).trim()
          if (cand.length <= 24) {
            cur = cand
          } else {
            lines.push(cur)
            cur = w
          }
        }
        if (cur) lines.push(cur)
        return (
          <g key={`${e.date}-${i}`}>
            {isHypothesis ? (
              <circle
                cx={x}
                cy={lineY}
                r={9}
                fill="none"
                stroke={solid}
                strokeWidth="2.5"
                strokeDasharray="3 2"
              />
            ) : (
              <circle cx={x} cy={lineY} r={8} fill={solid} />
            )}
            <text
              x={x}
              y={dateY}
              textAnchor="middle"
              fontSize="11"
              fill={TEXT_TERTIARY}
            >
              {e.date}
            </text>
            {lines.map((ln, li) => (
              <text
                key={li}
                x={x}
                y={baseY + li * 14}
                textAnchor="middle"
                fontSize="12"
                fill={TEXT_PRIMARY}
              >
                {ln}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function Sparkline({
  points,
  accent,
  width = 140,
  height = 36,
}: {
  points: number[]
  accent: AccentName
  width?: number
  height?: number
}) {
  if (points.length < 2) return null
  const pad = 2
  const vmax = Math.max(...points)
  const vmin = Math.min(...points)
  const rng = vmax - vmin || 1
  const stepX = (width - pad * 2) / (points.length - 1)
  const coords = points.map((v, i) => ({
    x: pad + i * stepX,
    y: height - pad - ((v - vmin) / rng) * (height - pad * 2),
  }))
  const d = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ')
  const last = coords[coords.length - 1]
  const col = ACCENT_COLOURS[accent].solid
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      className="rs-chart"
      role="img"
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={col}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={3} fill={col} />
    </svg>
  )
}

function MetricStrip({
  metrics,
  accent,
}: {
  metrics: FigureMetricItem[]
  accent: AccentName
}) {
  if (!metrics.length) return null
  const col = ACCENT_COLOURS[accent].solid
  return (
    <div className="rs-metric-strip">
      {metrics.map((m, i) => (
        <div key={`${m.label}-${i}`} className="rs-metric">
          <div className="rs-metric-value">{m.value}</div>
          <div className="rs-metric-label">{m.label}</div>
          {m.trend ? (
            <span className="rs-metric-trend" style={{ color: col }}>
              {m.trend}
            </span>
          ) : null}
          {m.sparkline && m.sparkline.length >= 2 ? (
            <Sparkline points={m.sparkline} accent={accent} />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ComparePies({
  items,
  accent,
}: {
  items: FigureCompareItem[]
  accent: AccentName
}) {
  if (!items.length) return null
  return (
    <div className="rs-compare-pies">
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} style={{ textAlign: 'center' }}>
          <DonutChart percent={it.percent} label={it.label} accent={accent} size={140} />
        </div>
      ))}
    </div>
  )
}

function PullQuote({
  data,
  accent,
}: {
  data: FigurePullQuoteData
  accent: AccentName
}) {
  const col = ACCENT_COLOURS[accent].solid
  return (
    <figure
      className="rs-pullquote"
      style={{ borderLeftColor: col, marginInline: 0 }}
    >
      <blockquote>«{data.text}»</blockquote>
      {data.attribution ? (
        <figcaption>— {data.attribution}</figcaption>
      ) : null}
    </figure>
  )
}

export function ResearchFigure({ figure, figureId }: { figure: Figure; figureId: string }) {
  const accent: AccentName = (figure.accent as AccentName) ?? 'rose'
  const data = figure.data as never
  const title = figure.title
  let body: React.ReactNode = null
  switch (figure.kind) {
    case 'hbar':
      body = <HBarChart data={data} accent={accent} unit={figure.unit} />
      break
    case 'columns':
      body = <ColumnsChart data={data} accent={accent} unit={figure.unit} />
      break
    case 'donut': {
      const d = data as { percent: number; label?: string }
      body = <DonutChart percent={d.percent} label={d.label} accent={accent} size={180} />
      break
    }
    case 'timeline':
      body = <TimelineChart events={data} accent={accent} />
      break
    case 'sparkline':
      body = <Sparkline points={data} accent={accent} />
      break
    case 'metric-strip':
      body = <MetricStrip metrics={data} accent={accent} />
      break
    case 'compare-pies':
      body = <ComparePies items={data} accent={accent} />
      break
    case 'pull-quote':
      body = <PullQuote data={data} accent={accent} />
      break
  }
  if (!body) return null
  return (
    <figure className="rs-figure" data-fid={figureId}>
      {title ? <div className="rs-figure-title">{title}</div> : null}
      {body}
    </figure>
  )
}
