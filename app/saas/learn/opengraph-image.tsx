import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'LevelChannel — CRM для частного репетитора'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
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
        {/* Warm radial glow bottom-right */}
        <div
          style={{
            position: 'absolute',
            right: -200,
            bottom: -200,
            width: 800,
            height: 800,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(232,168,144,0.22) 0%, transparent 65%)',
            display: 'flex',
          }}
        />

        {/* Top: brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width="48" height="48" viewBox="0 0 80 80">
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
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', gap: 4 }}>
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
        </div>

        {/* Middle: headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 980 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.05,
            }}
          >
            CRM для частного репетитора
          </div>
          <div
            style={{
              fontSize: 32,
              color: '#A1A1AA',
              lineHeight: 1.35,
              maxWidth: 900,
            }}
          >
            Расписание, ученики, балансы и оплаты — в одной открытой странице.
          </div>
        </div>

        {/* Bottom: row with pills + URL */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['0 ₽ навсегда', 'Без карты', '152-ФЗ'].map((t) => (
              <div
                key={t}
                style={{
                  padding: '12px 22px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontSize: 22,
                  color: '#D4D4D8',
                  background: 'rgba(255,255,255,0.03)',
                  display: 'flex',
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 24, color: '#E8A890', letterSpacing: '0.02em' }}>
            levelchannel.ru
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
