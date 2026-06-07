import Link from 'next/link'

import { BrandMark } from '@/components/brand/brand-mark'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

export function LandingV3Footer({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <footer
      style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '64px 24px 40px',
        background: '#0A0A0C',
      }}
    >
      <div style={{ maxWidth: 1216, margin: '0 auto', display: 'grid', gap: 48, gridTemplateColumns: '2fr repeat(3, 1fr)' }}>
        <div>
          <div style={{ marginBottom: 18, color: '#F5F5F7' }}>
            <BrandMark variant="full" width={140} />
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#A1A1AA', maxWidth: 240 }}>
            Кабинет для частного репетитора.
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Документы
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><Link href="/saas/offer" className="landing-v3-link">Оферта</Link></li>
            <li><Link href="/privacy" className="landing-v3-link">Политика конфиденциальности</Link></li>
            <li><Link href="/consent/personal-data" className="landing-v3-link">Согласие на ПДн</Link></li>
          </ul>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Реквизиты
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 1.85, color: '#A1A1AA' }}>
            <li>ИП {legalProfile.legalOperatorDisplay}</li>
            <li>ИНН: {legalProfile.legalOperatorTaxId}</li>
            <li>ОГРНИП: {legalProfile.legalOperatorOgrn}</li>
            <li>Р/С: {legalProfile.legalBankAccount}</li>
            <li>Банк: {legalProfile.legalBankName}</li>
            <li>БИК: {legalProfile.legalBankBik}</li>
          </ul>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Контакты
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><a href="mailto:support@levelchannel.ru" className="landing-v3-link">support@levelchannel.ru</a></li>
            <li><Link href="/pay" className="landing-v3-link">Уже учишься? — Оплатить</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
