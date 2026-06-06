import Link from 'next/link'

import { BrandMark } from '@/components/brand/brand-mark'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

// Shared across all 3 variants. Reuses server-loaded legalProfile per
// round-2 WARN #5 closure (no inline-object duplication; loadLegalProfile()
// is the single source).

export function LandingFooter({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <footer className="landing-v2-footer">
      <div className="landing-v2-footer__inner">
        <div className="landing-v2-footer__brand">
          <div className="landing-v2-footer__mark">
            <BrandMark variant="full" width={140} />
          </div>
          <p className="landing-v2-footer__tagline">
            Личный кабинет для преподавателя. Расписание, ученики, балансы.
          </p>
        </div>

        <div className="landing-v2-footer__col">
          <h3 className="landing-v2-footer__heading">Документы</h3>
          <ul className="landing-v2-footer__list">
            <li>
              <Link href="/saas/offer">SaaS-оферта</Link>
            </li>
            <li>
              <Link href="/saas/processor-terms">Условия процессинга</Link>
            </li>
            <li>
              <Link href="/privacy">Политика конфиденциальности</Link>
            </li>
            <li>
              <Link href="/consent/personal-data">Согласие на обработку ПДн</Link>
            </li>
          </ul>
        </div>

        <div className="landing-v2-footer__col">
          <h3 className="landing-v2-footer__heading">Реквизиты</h3>
          <ul className="landing-v2-footer__list landing-v2-footer__list--compact">
            <li>ИП {legalProfile.legalOperatorDisplay}</li>
            <li>ИНН: {legalProfile.legalOperatorTaxId}</li>
            <li>ОГРНИП: {legalProfile.legalOperatorOgrn}</li>
            <li>Р/С: {legalProfile.legalBankAccount}</li>
            <li>Банк: {legalProfile.legalBankName}</li>
            <li>БИК: {legalProfile.legalBankBik}</li>
          </ul>
        </div>

        <div className="landing-v2-footer__col">
          <h3 className="landing-v2-footer__heading">Контакты</h3>
          <ul className="landing-v2-footer__list">
            <li>
              <a href={`mailto:${legalProfile.publicContactEmail}`}>
                {legalProfile.publicContactEmail}
              </a>
            </li>
            <li>
              <Link href="/pay">Уже учишься? — Оплатить</Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
