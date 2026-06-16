'use client'

import Link from 'next/link'

import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

export function LandingFooter({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--v4-rule)',
        padding: '64px clamp(24px, 4vw, 80px) 48px',
        background: 'var(--v4-bg)',
      }}
    >
      <div
        style={{
          maxWidth: 'var(--v4-wide-w)',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 40,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--v4-font-serif)',
              fontSize: 20,
              marginBottom: 12,
              color: 'var(--v4-text-primary)',
            }}
          >
            LevelChannel
          </div>
          <p style={{ fontSize: 13, color: 'var(--v4-text-muted)', margin: 0, lineHeight: 1.6 }}>
            Кабинет для частного репетитора. Спокойный день, понятные деньги.
          </p>
        </div>
        <div>
          <h4 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--v4-text-muted)', margin: '0 0 14px' }}>
            Узнать больше
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <li><Link href="/saas/learn/cabinet" className="v4-link" style={{ fontSize: 14 }}>Как устроен кабинет</Link></li>
            <li><Link href="/saas/learn/sbp" className="v4-link" style={{ fontSize: 14 }}>Оплата через СБП</Link></li>
            <li><Link href="/saas/learn/multiplatform" className="v4-link" style={{ fontSize: 14 }}>На любом устройстве</Link></li>
            <li><Link href="/saas/learn/security" className="v4-link" style={{ fontSize: 14 }}>Безопасность и 152-ФЗ</Link></li>
            <li><Link href="/saas/learn/free" className="v4-link" style={{ fontSize: 14 }}>Бесплатный тариф</Link></li>
          </ul>
        </div>
        <div>
          <h4 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--v4-text-muted)', margin: '0 0 14px' }}>
            Research
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <li><Link href="/research" className="v4-link" style={{ fontSize: 14 }}>Все обзоры</Link></li>
            <li><Link href="/research/ai-online-teaching-ru-cis-12mo" className="v4-link" style={{ fontSize: 14 }}>Учитель и нейросеть: год в цифрах</Link></li>
          </ul>
        </div>
        <div>
          <h4 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--v4-text-muted)', margin: '0 0 14px' }}>
            Документы
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <li><Link href="/saas/offer" className="v4-link" style={{ fontSize: 14 }}>Оферта</Link></li>
            <li><Link href="/privacy" className="v4-link" style={{ fontSize: 14 }}>Политика</Link></li>
            <li><Link href="/consent/personal-data" className="v4-link" style={{ fontSize: 14 }}>Согласие</Link></li>
          </ul>
        </div>
        <div style={{ fontSize: 12, color: 'var(--v4-text-muted)', lineHeight: 1.7 }}>
          <div>{legalProfile.legalOperatorDisplay || 'ИП Фирсова Анастасия Геннадьевна'}</div>
          {legalProfile.legalOperatorTaxId ? <div>ИНН {legalProfile.legalOperatorTaxId}</div> : null}
          {legalProfile.legalOperatorOgrn ? <div>ОГРНИП {legalProfile.legalOperatorOgrn}</div> : null}
        </div>
      </div>
      <div
        style={{
          maxWidth: 'var(--v4-wide-w)',
          margin: '48px auto 0',
          paddingTop: 24,
          borderTop: '1px solid var(--v4-rule)',
          fontSize: 12,
          color: 'var(--v4-text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>© 2026 LevelChannel</div>
        <div>Сделано в России. Хостинг в России.</div>
      </div>
    </footer>
  )
}
