import { Pill } from '@/components/ui/primitives'

// /teacher/settings/digest — Push (PWA) channel placeholder card.
//
// Учительский Web Push ещё не отгружен (для учеников — bcs-def-4 уже
// в проде, для учителей это сделают отдельной волной). Карточку
// показываем сейчас, чтобы каналы виделись как набор, а не как
// e-mail + Telegram «и всё». Состояние — `Скоро`, без CTA, чтобы не
// порождать вопросов «куда нажать».

export function PushDigestCard() {
  return (
    <article
      className="digest-card digest-card-soon"
      data-testid="digest-channel-push"
      aria-disabled="true"
    >
      <header className="digest-card-head">
        <div className="digest-card-head-text">
          <h2 className="digest-card-title">Push в&nbsp;браузер</h2>
          <p className="digest-card-sub">PWA-уведомление на&nbsp;телефон или ноутбук</p>
        </div>
        <Pill tone="default">Скоро</Pill>
      </header>
      <p className="digest-card-body">
        Когда подключим — дайджест на&nbsp;день будет приходить как push-уведомление в&nbsp;браузер
        и&nbsp;на&nbsp;домашний экран iPhone/Android.
      </p>
    </article>
  )
}
