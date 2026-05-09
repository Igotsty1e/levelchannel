import Link from 'next/link'
import type { Metadata } from 'next'

import { PERSONAL_DATA_CONSENT_PATH } from '@/lib/legal/personal-data'
import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_CITY,
  LEGAL_BANK_CORR_ACCOUNT,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_CLAIMS_ADDRESS,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_REG_AUTHORITY,
  LEGAL_OPERATOR_TAX_ID,
  PUBLIC_CONTACT_EMAIL,
} from '@/lib/legal/public-profile'

export const metadata: Metadata = {
  title: 'Публичная оферта — LevelChannel',
  description: `Публичная оферта о заключении договора оказания образовательных услуг. ИП ${LEGAL_OPERATOR_DISPLAY}.`,
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
        <div className="legal-page-card" style={{ background: SURFACE, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '36px 40px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>

          <Section num="1" title="Общие положения">
            <P>Настоящий документ является официальным предложением (публичной офертой) Индивидуального предпринимателя:</P>
            <Highlight>
              <strong style={{ color: '#fff', fontSize: 16 }}>{LEGAL_OPERATOR_DISPLAY}</strong>
              <br />
              <span style={{ color: '#A1A1AA', fontSize: 14 }}>ИНН: {LEGAL_OPERATOR_TAX_ID}</span>
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
            <BulletList items={['образовательной платформы ProgressMe, предоставляемой ООО «ПрогрессМи», если это требуется для конкретного занятия', 'видеосвязи', 'мессенджеров и электронной почты', 'иных цифровых инструментов']} />
            <P style={{ marginTop: 12, marginBottom: 8 }}>Продолжительность занятий:</P>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {['50 минут', '60 минут', '90 минут'].map(t => (
                <span key={t} style={{ padding: '6px 16px', background: 'rgba(200,120,120,0.1)', border: '1px solid rgba(200,120,120,0.22)', borderRadius: 8, fontSize: 14, color: ACCENT_COLOR, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
            <P>Частота занятий определяется индивидуально.</P>
            <P style={{ marginBottom: 8 }}>Исполнитель вправе:</P>
            <BulletList items={['корректировать программу обучения', 'адаптировать формат занятий']} />
          </Section>

          <Section num="4" title="Стоимость и порядок оплаты">
            <P>На дату акцепта оферты стоимость одного индивидуального онлайн-занятия может составлять:</P>
            <BulletList items={['2500 рублей за 50 минут', '3500 рублей за 50 минут', '5000 рублей за 50 минут', '3500 рублей за 60 минут', '5250 рублей за 90 минут']} />
            <P>
              Конкретная стоимость занятия определяется до оплаты по
              предварительному согласованию сторон с учётом выбранной
              продолжительности, формата и иных согласованных условий оказания
              услуг. Если для одной и той же продолжительности в оферте указано
              несколько вариантов цены, применимая цена определяется по
              договорённости сторон до момента оплаты.
            </P>
            <P>
              На сайте доступна платёжная форма со свободным вводом суммы. Заказчик
              вводит только ту сумму, которая была предварительно согласована с
              Исполнителем за одно занятие либо за несколько занятий.
            </P>
            <P style={{ marginTop: 16 }}>
              При оплате нескольких занятий стоимость таких занятий суммируется,
              и денежные средства перечисляются одним платежом в размере общей
              согласованной суммы.
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
            <P>После согласования условий стороны определяют расписание занятий. Для каждого занятия Исполнитель резервирует Заказчику конкретный временной слот.</P>

            <P style={{ marginTop: 12 }}>Занятие считается оказанным, если оно фактически проведено в согласованное время.</P>

            <SubTitle style={{ marginTop: 16 }}>Порядок оплаты занятий</SubTitle>
            <P>Заказчик может оплачивать услуги одним из двух способов:</P>
            <BulletList items={[
              'По пакетам: Заказчик оплачивает фиксированный набор занятий заранее (например, 10 занятий по 60 минут). Каждое последующее занятие списывается из остатка пакета. Срок действия пакета — 6 (шесть) месяцев со дня оплаты; неиспользованные занятия по истечении этого срока сгорают, если иное не согласовано сторонами в письменной форме.',
              'По факту проведения (постоплата): индивидуально согласованный порядок, при котором Заказчик оплачивает каждое проведённое занятие по согласованному тарифу после его проведения. Возможность постоплаты предоставляется Исполнителем по своему усмотрению, как правило, постоянным Заказчикам с подтверждённой историей расчётов.',
            ]} />

            <P style={{ marginTop: 12 }}>Если у Заказчика есть действующий пакет занятий с подходящей длительностью, при записи на занятие соответствующее количество занятий списывается из пакета. При отсутствии действующего пакета и отсутствии согласованной с Исполнителем постоплаты Заказчик предварительно приобретает пакет занятий.</P>

            <SubTitle style={{ marginTop: 16 }}>Отмена и перенос занятий</SubTitle>
            <P>Заказчик вправе отменить или перенести занятие, предупредив Исполнителя <strong style={{ color: '#fff' }}>не менее чем за 24 часа</strong> до его начала. Уведомление направляется по электронной почте Исполнителя или по согласованному сторонами каналу связи (мессенджер). При своевременной отмене:</P>
            <BulletList items={[
              'для занятий, списанных из пакета, — соответствующее занятие восстанавливается в пакете и может быть использовано Заказчиком в пределах действия пакета;',
              'для занятий по постоплате — обязательство по оплате не возникает;',
              'для занятий, оплаченных отдельно вне пакета, — оплата зачитывается в счёт следующего согласованного занятия либо подлежит возврату по правилам §8.',
            ]} />

            <P style={{ marginTop: 12, marginBottom: 8 }}>Если Заказчик отменил занятие менее чем за 24 часа до его начала или не явился без предупреждения, Исполнитель вправе удержать стоимость такого занятия как согласованный сторонами размер фактически понесённых расходов на резервирование времени и подготовку к занятию (ст. 32 Закона РФ «О защите прав потребителей»). Удержание не применяется, в частности, если:</P>
            <BulletList items={[
              'отмена связана с болезнью Заказчика, подтверждённой медицинским документом',
              'отмена связана с обстоятельствами непреодолимой силы (форс-мажор)',
              'Исполнитель использовал освободившийся слот для иного оплачиваемого занятия',
            ]} />

            <P style={{ marginTop: 12 }}>Исполнитель вправе отменить или перенести занятие, предупредив Заказчика заранее. В этом случае стороны согласовывают альтернативное время; при невозможности согласования — оплата за такое занятие подлежит возврату в полном объёме в срок, установленный для возврата по требованию Заказчика (§8), либо для занятий, списанных из пакета, — занятие восстанавливается в пакете.</P>
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
            <P>Заказчик вправе в любое время отказаться от исполнения договора, уплатив Исполнителю фактически понесённые им расходы (ст. 32 Закона РФ «О защите прав потребителей»). Право на отказ от услуги не требует согласия Исполнителя.</P>

            <P style={{ marginTop: 12, marginBottom: 8 }}>При отказе Заказчика от пакета занятий возврату подлежит сумма, рассчитанная по формуле:</P>
            <BulletList items={[
              'оплаченная сумма пакета',
              'минус стоимость фактически проведённых занятий, рассчитанная как оплаченная сумма пакета, делённая на количество занятий в пакете',
              'минус удержания за занятия, отменённые менее чем за 24 часа без уважительных причин (§5)',
            ]} />

            <P style={{ marginTop: 12 }}>Возврат за фактически проведённые занятия не осуществляется.</P>

            <P style={{ marginTop: 12 }}>По неиспользованным занятиям пакета по истечении срока действия пакета (§5) возврат не осуществляется, кроме случая, когда стороны письменно согласовали продление срока действия или иной порядок зачёта.</P>

            <P style={{ marginTop: 12 }}>При отмене занятия со стороны Исполнителя без согласования альтернативного времени — возврат оплаты за такое занятие производится в полном объёме в срок, установленный для возврата по требованию Заказчика; для занятий, списанных из пакета, занятие восстанавливается в пакете без денежного возврата.</P>

            <P style={{ marginTop: 12, marginBottom: 8 }}>Возврат осуществляется:</P>
            <BulletList items={[
              'на банковскую карту, с которой производилась оплата',
              'в срок не более 10 календарных дней с даты получения требования (ст. 31 Закона РФ «О защите прав потребителей»)',
              'на основании письменного или электронного обращения Заказчика на адрес Исполнителя, указанный в §11',
            ]} />
          </Section>

          <Section num="9" title="Персональные данные">
            <P>При оплате сайт обрабатывает минимально необходимые данные заказа, включая e-mail плательщика, сумму, номер платежа, статус оплаты, а также технические данные подтверждения согласия на обработку персональных данных.</P>
            <P>После первичного контакта и оплаты Заказчик может дополнительно сообщить Исполнителю фамилию, имя, отчество, номер телефона и иные данные, необходимые для связи, записи, переноса и оказания услуг, в том числе при использовании платформы ProgressMe, предоставляемой ООО «ПрогрессМи», ИНН 7709999716, ОГРН 1177746434150, или иных согласованных каналов связи.</P>
            <P>Для исполнения договора и работы сайта данные могут передаваться, в частности, ООО «КЛАУДПЭЙМЕНТС», ИНН 7708806062, ОГРН 1147746077159, для приёма оплаты и направления электронных чеков, АО «ТаймВэб», ИНН 7810353960, ОГРН 1247800127112, для хостинга сайта и базы данных, а также ООО «ПрогрессМи», ИНН 7709999716, ОГРН 1177746434150, при использовании платформы ProgressMe для проведения занятий.</P>
            <P>Платёжные данные банковской карты обрабатываются исключительно платёжным провайдером CloudPayments. Подробные условия обработки персональных данных, сроки хранения и перечень используемых сервисов указаны в политике по адресу <Link href="/privacy" style={{ color: '#E89A90' }}>/privacy</Link>. Текст согласия на обработку персональных данных размещён по адресу <Link href={PERSONAL_DATA_CONSENT_PATH} style={{ color: '#E89A90' }}>{PERSONAL_DATA_CONSENT_PATH}</Link>.</P>
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
                <span style={{ background: ACCENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{LEGAL_OPERATOR_DISPLAY}</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {[
                  { label: 'ИНН', value: LEGAL_OPERATOR_TAX_ID },
                  { label: 'ОГРНИП', value: LEGAL_OPERATOR_OGRN },
                  { label: 'Регистрирующий орган', value: LEGAL_OPERATOR_REG_AUTHORITY },
                  { label: 'Адрес для претензий', value: LEGAL_OPERATOR_CLAIMS_ADDRESS },
                  { label: 'E-mail', value: PUBLIC_CONTACT_EMAIL },
                  { label: 'Расчётный счёт', value: LEGAL_BANK_ACCOUNT },
                  { label: 'Банк', value: LEGAL_BANK_NAME },
                  { label: 'БИК', value: LEGAL_BANK_BIK },
                  { label: 'Корр. счёт', value: LEGAL_BANK_CORR_ACCOUNT },
                  { label: 'Город', value: LEGAL_BANK_CITY },
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
