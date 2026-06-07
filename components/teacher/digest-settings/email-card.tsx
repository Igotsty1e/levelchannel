import { Pill } from '@/components/ui/primitives'

// /teacher/settings/digest — e-mail channel card.
//
// E-mail is the always-on channel: дайджест приходит на адрес аккаунта
// и его нельзя отключить, потому что это последняя точка контакта в
// случае утери Telegram-доступа. Сообщаем это спокойно, без модального
// «канал нельзя отключить» — пилл-статус + подпись «По умолчанию».
//
// SSR-рендеримая: никакого state, никаких actions.

export type EmailDigestCardProps = {
  email: string | null
}

export function EmailDigestCard({ email }: EmailDigestCardProps) {
  return (
    <article
      className="digest-card"
      data-testid="digest-channel-email"
    >
      <header className="digest-card-head">
        <div className="digest-card-head-text">
          <h2 className="digest-card-title">E-mail</h2>
          <p className="digest-card-sub">По умолчанию</p>
        </div>
        <Pill tone="success">Включён</Pill>
      </header>
      <p className="digest-card-body">
        Дайджест приходит на&nbsp;
        {email ? (
          <strong className="digest-email-address">{email}</strong>
        ) : (
          <span className="digest-email-fallback">e-mail аккаунта</span>
        )}
        . Поменять адрес можно в&nbsp;<a
          href="/teacher/profile"
          className="digest-card-link"
        >
          профиле
        </a>
        .
      </p>
    </article>
  )
}
