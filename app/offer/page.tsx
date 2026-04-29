import Link from 'next/link'
import type { Metadata } from 'next'

import { PERSONAL_DATA_CONSENT_PATH } from '@/lib/legal/personal-data'

export const metadata: Metadata = {
  title: 'Публичная оферта — LevelChannel',
  description: 'Публичная оферта о заключении договора оказания образовательных услуг. ИП Фирсова Анастасия Геннадьевна.',
}

const ACCENT = 'linear-gradient(135deg, #C87878, #E8A890)'
const ACCENT_COLOR = '#E89A90'
const BORDER = '1px solid rgba(255,255,255,0.07)'
const SURFACE = '#111113'

export default function OfferPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0B0B0C', color: '#fff', fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <span style={{ fontSize: 28, fontWeight: 900, fontStyle: 'italic', background: ACCENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', letterSpacing: '-0.04em', lineHeight: 1 }}>L</span>
            <span style={{ fontWeight: 700, fontSize: 17, color: '#fff', letterSpacing: '-0.01em' }}>evel<span style={{ background: ACCENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Channel</span></span>
          </Link>
          <Link
            href="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#A1A1AA', textDecoration: 'none', fontSize: 14, transition: 'color 0.2s' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            На главную
          </Link>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '56px 24px 80px' }}>

        {/* Title block */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'inline-block', padding: '5px 14px', background: 'rgba(200,120,120,0.1)', border: '1px solid rgba(200,120,120,0.22)', borderRadius: 100, fontSize: 12, fontWeight: 600, color: ACCENT_COLOR, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
            Юридический документ
          </div>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 10 }}>
            Публичная оферта
          </h1>
          <p style={{ fontSize: 16, color: '#A1A1AA', marginBottom: 6 }}>о заключении договора оказания образовательных услуг</p>
          <p style={{ fontSize: 13, color: '#52525B' }}>Последнее обновление: апрель 2026</p>
        </div>

        {/* Sections */}
        <div style={{ background: SURFACE, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '36px 40px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>

          <Section num="1" title="Общие положения">
            <P>Настоящий документ является официальным предложением (публичной офертой) Индивидуального предпринимателя:</P>
            <Highlight>
              <strong style={{ color: '#fff', fontSize: 16 }}>Фирсова Анастасия Геннадьевна</strong>
              <br />
              <span style={{ color: '#A1A1AA', fontSize: 14 }}>ИНН: 673202755730</span>
              <br />
              <span style={{ color: '#A1A1AA', fontSize: 14 }}>далее — «Исполнитель»</span>
            </Highlight>
            <P>и содержит все существенные условия оказания услуг.</P>
            <P>В соответствии со статьями 435 и 437 Гражданского кодекса РФ, данный документ является публичной офертой.</P>
            <P style={{ marginBottom: 8 }}>Акцептом настоящей оферты является:</P>
            <BulletList items={['оплата услуг', 'начало фактического получения услуг']} />
            <P style={{ marginTop: 12 }}>Акцепт оферты означает полное и безоговорочное согласие Заказчика со всеми условиями.</P>
          </Section>

          <Section num="2" title="Предмет договора">
            <P>Исполнитель оказывает услуги по обучению английскому языку в формате индивидуальных онлайн-занятий.</P>
            <P style={{ marginBottom: 8 }}>Услуги оказываются:</P>
            <BulletList items={['дистанционно (онлайн)', 'в формате 1:1', 'с индивидуальной программой обучения']} />
            <P style={{ marginTop: 12 }}>Услуги не являются образовательной деятельностью, подлежащей лицензированию, и не сопровождаются выдачей документов об образовании.</P>
          </Section>

          <Section num="3" title="Формат оказания услуг">
            <P style={{ marginBottom: 8 }}>Занятия проводятся онлайн с использованием:</P>
            <BulletList items={['видеосвязи', 'мессенджеров', 'иных цифровых инструментов']} />
            <P style={{ marginTop: 12, marginBottom: 8 }}>Продолжительность занятий:</P>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {['50 минут', '90 минут'].map(t => (
                <span key={t} style={{ padding: '6px 16px', background: 'rgba(200,120,120,0.1)', border: '1px solid rgba(200,120,120,0.22)', borderRadius: 8, fontSize: 14, color: ACCENT_COLOR, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
            <P>Частота занятий определяется индивидуально.</P>
            <P style={{ marginBottom: 8 }}>Исполнитель вправе:</P>
            <BulletList items={['корректировать программу обучения', 'адаптировать формат занятий']} />
          </Section>

          <Section num="4" title="Стоимость и порядок оплаты">
            <P>
              Стоимость занятий и иных услуг согласовывается с Заказчиком индивидуально до момента
              оплаты.
            </P>
            <P>
              На сайте доступна платёжная форма со свободным вводом суммы. Заказчик вводит только
              ту сумму, которая была предварительно согласована с Исполнителем.
            </P>
            <P style={{ marginTop: 16 }}>
              Исполнитель вправе изменять цены и условия оплаты с уведомлением Заказчика.{' '}
              <span style={{ color: '#E89A90' }}>Стоимость может отличаться в зависимости от формата, длительности занятия и договорённостей сторон.</span>
            </P>
            <P style={{ marginBottom: 8 }}>Оплата производится:</P>
            <BulletList items={['через платёжный сервис CloudPayments', 'с использованием банковской карты и иных методов, доступных в платёжной форме']} />
            <P style={{ marginTop: 12 }}>Моментом оплаты считается поступление денежных средств Исполнителю.</P>
            <P style={{ marginBottom: 8 }}>Услуги могут оплачиваться:</P>
            <BulletList items={['разово', 'пакетами занятий']} />
            <P style={{ marginTop: 12 }}>
              Электронный чек направляется покупателю на e-mail, указанный в платёжной форме,
              средствами CloudPayments / CloudKassir.
            </P>
          </Section>

          <Section num="5" title="Порядок оказания услуг">
            <P>После согласования условий стороны договариваются о расписании.</P>
            <P style={{ marginBottom: 8 }}>Занятие считается проведённым, если:</P>
            <BulletList items={['Заказчик присутствовал', 'Заказчик не предупредил об отмене заранее']} />
            <P style={{ marginTop: 12 }}>Отмена или перенос занятия — не менее чем за <strong style={{ color: '#fff' }}>24 часа</strong>.</P>
            <P style={{ marginBottom: 8 }}>В случае несвоевременной отмены:</P>
            <BulletList items={['занятие считается проведённым', 'оплата не возвращается']} />
          </Section>

          <Section num="6" title="Права и обязанности сторон">
            <SubTitle>Исполнитель обязан:</SubTitle>
            <BulletList items={['оказывать услуги качественно', 'соблюдать согласованное расписание', 'предоставлять обратную связь']} />
            <SubTitle style={{ marginTop: 16 }}>Исполнитель вправе:</SubTitle>
            <BulletList items={['изменять программу обучения', 'приостанавливать занятия при нарушении условий']} />
            <SubTitle style={{ marginTop: 16 }}>Заказчик обязан:</SubTitle>
            <BulletList items={['соблюдать расписание', 'своевременно оплачивать услуги', 'выполнять рекомендации']} />
            <SubTitle style={{ marginTop: 16 }}>Заказчик вправе:</SubTitle>
            <BulletList items={['получать услуги в полном объёме', 'задавать вопросы и получать обратную связь']} />
          </Section>

          <Section num="7" title="Ответственность сторон">
            <P style={{ marginBottom: 8 }}>Исполнитель не гарантирует достижение конкретного результата, так как он зависит от:</P>
            <BulletList items={['усилий Заказчика', 'регулярности занятий', 'выполнения заданий']} />
            <P style={{ marginTop: 12, marginBottom: 8 }}>Исполнитель не несёт ответственности за:</P>
            <BulletList items={['технические сбои на стороне Заказчика', 'качество интернет-соединения Заказчика']} />
          </Section>

          <Section num="8" title="Возврат денежных средств">
            <P style={{ marginBottom: 8 }}>Возврат возможен:</P>
            <BulletList items={['по соглашению сторон', 'при невозможности оказания услуг Исполнителем']} />
            <P style={{ marginTop: 12 }}>Возврат за уже проведённые занятия не осуществляется.</P>
          </Section>

          <Section num="9" title="Персональные данные">
            <P>При оплате сайт обрабатывает минимально необходимые данные заказа, включая e-mail плательщика, сумму, номер платежа, статус оплаты, а также технические данные подтверждения согласия на обработку персональных данных.</P>
            <P>После первичного контакта и оплаты Заказчик может дополнительно сообщить Исполнителю фамилию, имя, отчество, номер телефона и иные данные, необходимые для связи, записи, переноса и оказания услуг.</P>
            <P>Платёжные данные банковской карты обрабатываются исключительно платёжным провайдером CloudPayments. Текст согласия на обработку персональных данных размещён по адресу <Link href={PERSONAL_DATA_CONSENT_PATH} style={{ color: '#E89A90' }}>{PERSONAL_DATA_CONSENT_PATH}</Link>.</P>
          </Section>

          <Section num="10" title="Срок действия и расторжение">
            <P>Договор вступает в силу с момента акцепта.</P>
            <P style={{ marginBottom: 8 }}>Договор может быть расторгнут:</P>
            <BulletList items={['по инициативе любой из сторон', 'при нарушении условий']} />
          </Section>

          <Section num="11" title="Реквизиты Исполнителя" last>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: BORDER, borderRadius: 14, padding: '24px 28px', marginTop: 4 }}>
              <p style={{ fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 20 }}>
                Индивидуальный предприниматель<br />
                <span style={{ background: ACCENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Фирсова Анастасия Геннадьевна</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {[
                  { label: 'ИНН', value: '673202755730' },
                  { label: 'Расчётный счёт', value: '40802810720000971101' },
                  { label: 'Банк', value: 'ООО «Банк Точка»' },
                  { label: 'БИК', value: '044525104' },
                  { label: 'Корр. счёт', value: '30101810745374525104' },
                  { label: 'Город', value: 'г. Москва' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#52525B', marginBottom: 3, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{item.label}</div>
                    <div style={{ fontSize: 14, color: '#E4E4E7', fontWeight: 500 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

        </div>
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 48, paddingTop: 32, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 13, color: '#52525B' }}>© 2025 LevelChannel. Все права защищены.</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Link href="/privacy" style={{ fontSize: 13, color: '#A1A1AA', textDecoration: 'none' }}>
              Политика персональных данных
            </Link>
            <Link href={PERSONAL_DATA_CONSENT_PATH} style={{ fontSize: 13, color: '#A1A1AA', textDecoration: 'none' }}>
              Согласие на обработку ПДн
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────── */

function Section({ num, title, children, last = false }: { num: string; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ paddingBottom: last ? 0 : 36, marginBottom: last ? 0 : 36, borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 800, background: 'linear-gradient(135deg, #C87878, #E8A890)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', letterSpacing: '0.05em', flexShrink: 0 }}>
          {num.padStart(2, '0')}
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>{title}</h2>
      </div>
      <div>{children}</div>
    </div>
  )
}

function P({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 15, color: '#A1A1AA', lineHeight: 1.75, marginBottom: 8, ...style }}>{children}</p>
}

function SubTitle({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 14, fontWeight: 600, color: '#D4D4D8', marginBottom: 8, ...style }}>{children}</p>
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <li key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#A1A1AA', lineHeight: 1.6 }}>
          <span style={{ color: '#C87878', flexShrink: 0, marginTop: 2, fontWeight: 700 }}>—</span>
          {item}
        </li>
      ))}
    </ul>
  )
}

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(200,120,120,0.06)', border: '1px solid rgba(200,120,120,0.15)', borderRadius: 10, padding: '14px 18px', margin: '12px 0', lineHeight: 1.9 }}>
      {children}
    </div>
  )
}

function PricingTable() {
  const rows = [
    { label: '50 минут', desc: 'Обычные уроки', price: '3 500 ₽' },
    { label: '50 минут', desc: 'Подготовка к экзаменам', price: '5 000 ₽' },
    { label: '90 минут', desc: 'Экстренная подготовка к экзаменам', price: '10 000 ₽' },
  ]
  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 18px', background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', gap: 12 }}>
          <div>
            <span style={{ fontSize: 13, color: '#A1A1AA' }}>{row.label} · </span>
            <span style={{ fontSize: 14, color: '#E4E4E7' }}>{row.desc}</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, #C87878, #E8A890)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', flexShrink: 0 }}>{row.price}</span>
        </div>
      ))}
    </div>
  )
}
