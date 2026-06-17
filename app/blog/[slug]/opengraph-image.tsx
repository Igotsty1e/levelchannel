import { ImageResponse } from 'next/og'

import { loadBlogPost } from '@/lib/blog/load-post'

export const runtime = 'nodejs'
export const alt = 'Level Channel — Журнал'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

type Params = { slug: string }

export default async function OgImage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const post = await loadBlogPost(slug)
  const headline = post?.title ?? 'Level Channel — Журнал'
  const lede = post?.lede ?? ''
  const author = post?.author?.name ?? 'Иван Ханаев'
  const date = post?.published_at?.slice(0, 10) ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0E0E10',
          padding: 72,
          color: '#F0EBE3',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -180,
            bottom: -180,
            width: 760,
            height: 760,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(232,168,144,0.22) 0%, transparent 65%)',
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
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              display: 'flex',
              gap: 4,
            }}
          >
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
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.16)',
              fontSize: 16,
              color: '#E8A890',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex',
            }}
          >
            Журнал
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 980 }}>
          <div
            style={{
              fontSize: headline.length > 60 ? 50 : 60,
              fontWeight: 400,
              fontFamily: 'Georgia, "Times New Roman", serif',
              letterSpacing: '-0.015em',
              lineHeight: 1.08,
            }}
          >
            {headline}
          </div>
          {lede ? (
            <div
              style={{
                fontSize: 22,
                color: '#C9C2B6',
                lineHeight: 1.4,
                maxWidth: 920,
                fontStyle: 'italic',
                fontFamily: 'Georgia, "Times New Roman", serif',
              }}
            >
              {lede.slice(0, 180)}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 24,
            borderTop: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 18, color: '#C9C2B6' }}>
            <span style={{ color: '#F0EBE3', fontWeight: 500 }}>{author}</span>
            {date ? <span>· {date}</span> : null}
          </div>
          <div style={{ fontSize: 18, color: '#E8A890', letterSpacing: '0.02em' }}>
            levelchannel.ru/blog
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
