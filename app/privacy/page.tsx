import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — LevelChannel',
}

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B0B0C',
        color: '#fff',
        fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
        padding: '80px 24px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: '#A1A1AA',
            textDecoration: 'none',
            fontSize: 14,
            marginBottom: 40,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Вернуться на главную
        </Link>

        <div
          style={{
            display: 'inline-block',
            padding: '6px 14px',
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: 100,
            fontSize: 13,
            fontWeight: 500,
            color: '#A78BFA',
            marginBottom: 16,
          }}
        >
          Документ
        </div>

        <h1
          style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginBottom: 8,
          }}
        >
          Политика конфиденциальности
        </h1>
        <p style={{ color: '#A1A1AA', fontSize: 14, marginBottom: 48 }}>
          Последнее обновление: апрель 2026
        </p>

        <div
          style={{
            background: '#111113',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '40px',
          }}
        >
          <Section title="1. Общие положения">
            Настоящая Политика конфиденциальности описывает, каким образом ИП Фирсова Анастасия Геннадьевна
            (далее — «Оператор») обрабатывает данные пользователей сайта LevelChannel.
          </Section>

          <Section title="2. Данные оплаты и технические данные">
            <strong>Сайт не собирает и не хранит платёжные реквизиты банковских карт пользователей.</strong>
            <br /><br />
            При использовании сайта и оплате могут обрабатываться:
            <ul style={{ marginTop: 12, paddingLeft: 20, color: '#A1A1AA', lineHeight: 2 }}>
              <li>данные заказа: номер счёта, сумма, e-mail плательщика, статус оплаты, дата и время операции</li>
              <li>служебные сетевые данные: IP-адрес, user-agent и технические журналы сервера</li>
              <li>данные, которые платёжный провайдер передаёт в уведомлениях о статусе оплаты</li>
            </ul>
          </Section>

          <Section title="3. Коммуникация">
            Связь с Оператором осуществляется через мессенджер Telegram. Обработка данных в рамках переписки
            регулируется политикой конфиденциальности сервиса Telegram (Telegram Messenger Inc.).
          </Section>

          <Section title="4. Платежи">
            Платежи за услуги обрабатываются через CloudPayments. Встроенная платёжная форма принимает
            банковские карты и иные доступные в платёжной форме методы оплаты. Электронный чек
            формируется и направляется покупателю на указанный e-mail средствами CloudPayments /
            CloudKassir. Оператор не хранит и не обрабатывает номера карт, CVV/CVC и иные карточные
            реквизиты пользователей.
          </Section>

          <Section title="5. Cookies">
            Сайт может использовать технические cookies для корректной работы. Cookies не содержат
            персональных данных и используются исключительно в технических целях.
          </Section>

          <Section title="6. Контакты" last>
            По вопросам, связанным с обработкой данных, обращайтесь через Telegram:
            <br />
            <a
              href="https://t.me/anastasiia_englishcoach"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#A78BFA', marginTop: 8, display: 'inline-block' }}
            >
              @anastasiia_englishcoach
            </a>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  last = false,
}: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div style={{ marginBottom: last ? 0 : 32, paddingBottom: last ? 0 : 32, borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, color: '#fff' }}>{title}</h2>
      <div style={{ fontSize: 15, color: '#A1A1AA', lineHeight: 1.75 }}>{children}</div>
    </div>
  )
}
