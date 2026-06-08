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
      <div className="landing-v3-footer-grid" style={{ maxWidth: 1216, margin: '0 auto', display: 'grid', gap: 48, gridTemplateColumns: '1.4fr repeat(3, 1fr)' }}>
        <div>
          <div style={{ marginBottom: 18, color: '#F5F5F7' }}>
            <BrandMark variant="full" width={140} />
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#A1A1AA', maxWidth: 240 }}>
            Кабинет для частного репетитора. Спокойный день, понятные деньги.
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: '#6B6B73', marginTop: 14 }}>
            <a href="mailto:support@levelchannel.ru" className="landing-v3-link">support@levelchannel.ru</a>
            <br />
            <Link href="/pay" className="landing-v3-link">Уже учишься? — Оплатить</Link>
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Узнать больше
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><Link href="/saas/learn/cabinet" className="landing-v3-link">Как устроен кабинет</Link></li>
            <li><Link href="/saas/learn/crm-for-tutors" className="landing-v3-link">CRM для репетитора</Link></li>
            <li><Link href="/saas/learn/schedule" className="landing-v3-link">Расписание</Link></li>
            <li><Link href="/saas/learn/students" className="landing-v3-link">Карточка ученика</Link></li>
            <li><Link href="/saas/learn/sbp" className="landing-v3-link">Оплата через СБП</Link></li>
            <li><Link href="/saas/learn/packages" className="landing-v3-link">Пакеты уроков</Link></li>
          </ul>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            И ещё
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><Link href="/saas/learn/notifications" className="landing-v3-link">Уведомления и дайджест</Link></li>
            <li><Link href="/saas/learn/multiplatform" className="landing-v3-link">На любом устройстве</Link></li>
            <li><Link href="/saas/learn/security" className="landing-v3-link">Безопасность и 152-ФЗ</Link></li>
            <li><Link href="/saas/learn/free" className="landing-v3-link">Бесплатный тариф</Link></li>
            <li style={{ marginTop: 10 }}>
              <Link href="/saas/offer" className="landing-v3-link">Оферта</Link>
              {' · '}
              <Link href="/privacy" className="landing-v3-link">Политика</Link>
              {' · '}
              <Link href="/consent/personal-data" className="landing-v3-link">Согласие</Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Реквизиты
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12, lineHeight: 1.85, color: '#A1A1AA' }}>
            <li>ИП {legalProfile.legalOperatorDisplay}</li>
            <li>ИНН: {legalProfile.legalOperatorTaxId}</li>
            <li>ОГРНИП: {legalProfile.legalOperatorOgrn}</li>
            <li>Р/С: {legalProfile.legalBankAccount}</li>
            <li>Банк: {legalProfile.legalBankName}</li>
            <li>БИК: {legalProfile.legalBankBik}</li>
            {legalProfile.legalBankCity ? <li>Город банка: {legalProfile.legalBankCity}</li> : null}
          </ul>
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .landing-v3-footer-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
        }
      `}</style>
    </footer>
  )
}
