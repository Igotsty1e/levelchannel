import type { Metadata } from 'next'

import { SeoArticle } from '@/components/saas/landing-v4/_shared/seo-article'

/**
 * Dedicated landing page for the Google Calendar integration.
 *
 * Two purposes:
 *
 *   1. SEO — answers "what does LevelChannel do with Google Calendar"
 *      for tutors searching how this CRM hooks into their existing
 *      Google workflow.
 *
 *   2. Google OAuth App Verification — Google's review team needs a
 *      page on the verified domain that explicitly describes the
 *      OAuth scope use (calendar.events.readonly + calendar.events),
 *      what data is accessed, who can see it, and where the privacy
 *      policy lives. Without such a page the OAuth verification
 *      rejects with "your home page does not explain the purpose
 *      of your app". This page is referenced from the Google Cloud
 *      Console "Application home page" field, and the home page
 *      links to it as well.
 */

export const metadata: Metadata = {
  title: 'Google Calendar для репетитора — интеграция с LevelChannel',
  description:
    'Как LevelChannel работает с Google Calendar: какие данные читает и пишет, кто видит события, и как это связано с расписанием учеников.',
  alternates: { canonical: '/integrations/google-calendar' },
  openGraph: {
    title: 'LevelChannel × Google Calendar — для частного репетитора',
    description:
      'Слот в кабинете автоматически создаёт событие в Google-календаре учителя и ученика. Только события занятий, ничего лишнего.',
    type: 'article',
    images: ['/saas/learn/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LevelChannel × Google Calendar',
    description: 'Какие данные читаем и пишем; кто видит события.',
    images: ['/saas/learn/opengraph-image'],
  },
}

export default function IntegrationGoogleCalendarPage() {
  return (
    <SeoArticle
      eyebrow="LevelChannel · Интеграция с Google Calendar"
      h1={<>LevelChannel × Google Calendar</>}
      headline="LevelChannel × Google Calendar — интеграция для репетитора"
      breadcrumbTitle="Google Calendar"
      publishedAt="2026-06-06"
      updatedAt="2026-06-09"
      lede="LevelChannel — это веб-приложение CRM для частного репетитора (страница приложения: https://levelchannel.ru). Эта страница описывает, как LevelChannel интегрируется с Google Calendar: какие OAuth-разрешения мы запрашиваем, какие данные мы читаем и пишем, и кто их видит. Авторизация Google нужна, чтобы автоматически создавать события занятий в календаре учителя и ученика, когда учитель назначает слот в кабинете LevelChannel."
      sections={[
        {
          id: 'what',
          h2: 'Что делает интеграция',
          body: (
            <>
              <p>
                <strong>Слот → событие.</strong> Когда учитель назначает занятие в кабинете LevelChannel (например, «Маша, вторник 14:00–15:00»), мы создаём событие в Google Calendar этого учителя с заголовком «Урок: Маша», временем, длительностью, ссылкой на Google Meet (если включена) и ссылкой обратно в кабинет.
              </p>
              <p>
                <strong>Перенос → обновление события.</strong> Если занятие переносится, мы обновляем то же самое событие в Google-календаре — учитель и ученик видят актуальное время.
              </p>
              <p>
                <strong>Отмена → удаление события.</strong> Отменённый слот в кабинете удаляет соответствующее событие из календаря.
              </p>
              <p>
                <strong>Конфликты.</strong> Перед созданием слота мы читаем события Google-календаря на этот промежуток, чтобы предупредить о пересечении (например, если в это время уже стоит другая встреча).
              </p>
            </>
          ),
        },
        {
          id: 'scopes',
          h2: 'Какие OAuth scope мы запрашиваем и зачем',
          body: (
            <>
              <p>
                Авторизация через Google запрашивает два scope:
              </p>
              <ul>
                <li>
                  <code>https://www.googleapis.com/auth/calendar.events</code> — нужен, чтобы создавать, обновлять и удалять события занятий в календаре учителя. Без этого права интеграция не работает.
                </li>
                <li>
                  <code>https://www.googleapis.com/auth/calendar.readonly</code> — нужен, чтобы прочитать существующие события в момент создания слота и предупредить о конфликте. Мы не читаем содержимое чужих событий — только время, чтобы понять, что промежуток занят.
                </li>
              </ul>
              <p>
                <strong>Чего мы НЕ делаем:</strong> мы не читаем другие календари, не сканируем чужие встречи, не пересылаем данные третьим лицам, не показываем их рекламным сетям. Один календарь — один учитель — события его занятий.
              </p>
            </>
          ),
        },
        {
          id: 'who-sees',
          h2: 'Кто видит твои данные',
          body: (
            <>
              <p>
                <strong>Только ты.</strong> События в твоём Google-календаре видишь ты сам — никто из команды LevelChannel не имеет доступа к OAuth-токенам в открытом виде. Токены хранятся зашифрованными ключом AES-256, который сам по себе не лежит в коде.
              </p>
              <p>
                <strong>Ученик видит только своё.</strong> Если ученик подключил свой Google-календарь к кабинету, в его календаре появляются события его занятий с тобой — не чужих учеников.
              </p>
              <p>
                <strong>Отзыв доступа в один клик.</strong> В любой момент можно отозвать доступ — через настройки кабинета «Интеграции → Google Calendar → отключить» или через панель Google «Безопасность → доступ сторонних приложений». После отзыва мы удаляем токен из базы.
              </p>
            </>
          ),
        },
        {
          id: 'privacy',
          h2: 'Безопасность и 152-ФЗ',
          body: (
            <>
              <p>
                Серверы LevelChannel находятся на территории Российской Федерации, как требует ч. 5 ст. 18 152-ФЗ. Персональные данные пользователей-граждан РФ обрабатываются на этих серверах.
              </p>
              <p>
                Подробнее — в{' '}
                <a href="/privacy">политике обработки персональных данных</a>
                {' '}и{' '}
                <a href="/consent/personal-data">тексте согласия</a>
                .
              </p>
            </>
          ),
        },
        {
          id: 'how-to',
          h2: 'Как подключить',
          body: (
            <>
              <p>
                <strong>1. Зарегистрируйся в роли учителя</strong> на{' '}
                <a href="/register?role=teacher">levelchannel.ru/register</a>
                . Стартовый тариф бесплатный — карта не нужна.
              </p>
              <p>
                <strong>2. Открой раздел «Настройки → Календарь»</strong> в кабинете и нажми «Подключить Google Calendar». Откроется стандартное окно согласия Google — ты увидишь, какие именно scope запрашиваются.
              </p>
              <p>
                <strong>3. Создай первый слот.</strong> Через несколько секунд событие появится в твоём Google-календаре. Готово.
              </p>
            </>
          ),
        },
      ]}
      faq={[
        {
          q: 'Можно ли отключить интеграцию после подключения?',
          a: 'Да. В настройках кабинета «Интеграции → Google Calendar → отключить». После отключения мы удаляем OAuth-токены из базы. Существующие события в Google-календаре остаются — ты управляешь ими как обычно.',
        },
        {
          q: 'Что если у меня несколько Google-аккаунтов?',
          a: 'Подключается один аккаунт на учителя. Можно сменить аккаунт через отключение текущей привязки и подключение новой.',
        },
        {
          q: 'События появляются в чужом календаре, если я подключил рабочий аккаунт?',
          a: 'Нет, события создаются только в том календаре, который ты сам выбрал при подключении. Чужие календари в Google не затрагиваются.',
        },
        {
          q: 'Можно ли использовать LevelChannel без подключения календаря?',
          a: 'Да. Календарная интеграция опциональна. Без неё ты по-прежнему ведёшь расписание, ученики получают напоминания в Telegram и на e-mail. Просто события не дублируются в Google-календарь.',
        },
        {
          q: 'Какой у вас Privacy Policy URL?',
          a: 'https://levelchannel.ru/privacy — там описано, какие данные мы храним, сколько и как их удалить.',
        },
        {
          q: 'Какой у вас Application Homepage URL?',
          a: 'https://levelchannel.ru — главная страница продукта.',
        },
      ]}
      ctaText="Подключить Google Calendar"
      ctaHref="/register?role=teacher&utm_source=integration-google-calendar"
    />
  )
}
