import { ImageResponse } from 'next/og'

import { loadResearchPost } from '@/lib/research/load-post'

export const runtime = 'nodejs' // need fs access for content/research/
export const alt = 'Level Channel Research'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

type Params = { slug: string }

export default async function OgImage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const post = await loadResearchPost(slug)
  const headline = post?.seo.title ?? 'Level Channel Research'
  const lede = post?.seo.description ?? ''
  const date = post?.seo.published_at?.slice(0, 10) ?? ''
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0B0B0C',
          padding: 80,
          color: '#F5F5F7',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -200,
            bottom: -200,
            width: 900,
            height: 900,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(232,168,144,0.28) 0%, transparent 65%)',
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width="44" height="44" viewBox="0 0 80 80">
            <defs>
              <linearGradient id="og-grad" gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="80" y2="0">
                <stop offset="0%" stopColor="#C87878" />
                <stop offset="100%" stopColor="#E8A890" />
              </linearGradient>
            </defs>
            <g
              transform="translate(6,66) rotate(-28)"
              stroke="url(#og-grad)"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M 0 0 Q 12 -22 24 0 T 48 0 T 72 0" strokeWidth="6" />
              <circle cx="0" cy="0" r="6" fill="url(#og-grad)" stroke="none" />
              <circle cx="72" cy="0" r="6" fill="url(#og-grad)" stroke="none" />
            </g>
          </svg>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', gap: 4 }}>
            <span>Level</span>
            <span
              style={{
                background: 'linear-gradient(135deg, #C87878, #E8A890)',
                backgroundClip: 'text',
                color: 'transparent',
                fontWeight: 800,
              }}
            >
              Channel
            </span>
          </div>
          <div
            style={{
              marginLeft: 16,
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.16)',
              fontSize: 18,
              color: '#E8A890',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex',
            }}
          >
            Research
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 980 }}>
          <div
            style={{
              fontSize: headline.length > 60 ? 58 : 68,
              fontWeight: 700,
              letterSpacing: '-0.022em',
              lineHeight: 1.06,
            }}
          >
            {headline}
          </div>
          {lede ? (
            <div
              style={{
                fontSize: 26,
                color: '#A1A1AA',
                lineHeight: 1.4,
                maxWidth: 980,
              }}
            >
              {lede.slice(0, 180)}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Открытые источники', 'Каждая цифра проверена', 'Без маркетинга'].map((t) => (
              <div
                key={t}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: 18,
                  color: '#D4D4D8',
                  background: 'rgba(255,255,255,0.03)',
                  display: 'flex',
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 20, color: '#E8A890', letterSpacing: '0.02em' }}>
            levelchannel.ru/research{date ? ` · ${date}` : ''}
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
