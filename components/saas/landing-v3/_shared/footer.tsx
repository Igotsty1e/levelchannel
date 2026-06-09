import { BrandMark } from '@/components/brand/brand-mark'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'
import { TrackedAnchor, TrackedLink } from './tracked-link'

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
            <TrackedAnchor href="mailto:support@levelchannel.ru" className="landing-v3-link" target="footer:email">support@levelchannel.ru</TrackedAnchor>
            <br />
            <TrackedLink href="/pay" className="landing-v3-link" target="footer:pay">Уже учишься? — Оплатить</TrackedLink>
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            Узнать больше
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><TrackedLink href="/saas/learn/cabinet" className="landing-v3-link" target="footer:learn:cabinet">Как устроен кабинет</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/crm-for-tutors" className="landing-v3-link" target="footer:learn:crm">CRM для репетитора</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/schedule" className="landing-v3-link" target="footer:learn:schedule">Расписание</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/students" className="landing-v3-link" target="footer:learn:students">Карточка ученика</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/sbp" className="landing-v3-link" target="footer:learn:sbp">Оплата через СБП</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/packages" className="landing-v3-link" target="footer:learn:packages">Пакеты уроков</TrackedLink></li>
          </ul>
        </div>

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F5F5F7', marginBottom: 14 }}>
            И ещё
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13, lineHeight: 2, color: '#A1A1AA' }}>
            <li><TrackedLink href="/saas/learn/notifications" className="landing-v3-link" target="footer:learn:notifications">Уведомления и дайджест</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/multiplatform" className="landing-v3-link" target="footer:learn:multiplatform">На любом устройстве</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/security" className="landing-v3-link" target="footer:learn:security">Безопасность и 152-ФЗ</TrackedLink></li>
            <li><TrackedLink href="/saas/learn/free" className="landing-v3-link" target="footer:learn:free">Бесплатный тариф</TrackedLink></li>
            <li><TrackedLink href="/integrations/google-calendar" className="landing-v3-link" target="footer:integration:google-calendar">Google Calendar — интеграция</TrackedLink></li>
            <li style={{ marginTop: 10 }}>
              <TrackedLink href="/saas/offer" className="landing-v3-link" target="footer:legal:offer">Оферта</TrackedLink>
              {' · '}
              <TrackedLink href="/privacy" className="landing-v3-link" target="footer:legal:privacy">Политика</TrackedLink>
              {' · '}
              <TrackedLink href="/consent/personal-data" className="landing-v3-link" target="footer:legal:consent">Согласие</TrackedLink>
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
