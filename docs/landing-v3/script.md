# LevelChannel landing v3 — сценарий, экран за экраном

**Статус:** draft 1. Локальный, не пушим. Правим в чате до OK, потом kie.ai → код.

**Направление визуала:** rauno.me (плотная типографика, subtle micro-interactions) + mymind.com (тёплый narrative scroll) + soulver.app (минимализм без перегруза) + darkrise-astro (тёмный editorial-grid, точечные акценты, gradient outlines на CTA).

**Тон:** на «ты». Преимущественно (a) короткий формат (заголовок + 1 параграф), (b) editorial 2-3 параграфа — только на болях и про безопасность.

**Нарратив:** хаос на столе → один кабинет. От «6 вкладок и 12 переписок» к «один экран знает всё».

**Палитра:**
- `#0B0B0C` фон / `#111113` surface / `#16161A` elevated card
- `#C87878 → #E8A890` accent gradient (точечно: CTA, ключевые акценты, не радуга)
- `#F5F5F7` text primary / `#A1A1AA` secondary / `#6B6B73` muted
- Editorial warm surface (для боли): `#1A1818`

**Шрифт:** Inter (UI/sans), Georgia/Iowan Old Style (editorial-сериф там где боль и безопасность).

**Анимация — четыре слоя одновременно на каждом экране:**
1. **Фон (continuous):** Aceternity background block (Beams / Aurora / Grid / Wavy / Boxes / Spotlight)
2. **Боковые акценты (idle):** Framer Motion subtle float / drift
3. **Внутри секции (on scroll-into-view):** Text Generate Effect / NumberTicker / 3D-tilt
4. **Центральный визуал:** kie.ai illustration или Veo 3.1 ambient loop

---

## Экран 1 — Hero (открытие)

**Цель:** в первые 3 секунды объяснить «что это и для кого».

**Структура:**
- **Eyebrow** (мелкий лейбл, тёмно-серый): `Кабинет для частного репетитора`
- **H1** (clamp 56-112px, плотная типографика как у rauno.me): `Один экран`
- (с разрывом строки) `вместо шести вкладок.`
- **Lede** (под H1, ~22px, до 60ch): `Расписание, ученики, балансы, пакеты. То, что репетитор реально открывает каждый день — собрано в одном месте. Бесплатно, навсегда, для первого ученика.`
- **CTA primary** (gradient outline, magnetic): `Начать бесплатно →` (`/register?role=teacher&utm_source=landing-v3&utm_content=hero`)
- **CTA secondary** (text link под кнопкой): `Посмотреть, как выглядит` (anchor на экран 6 «Что внутри»)
- **Trust line** (мелким, под CTA): `Без карты при регистрации · Данные не передаются третьим лицам`

**Фон (Aceternity):** `Background Beams` — три тонких диагональных луча через всё окно, цвета `#C87878` → прозрачность. Медленный drift.

**Боковые акценты (Framer Motion):**
- В правом верхнем углу — анимированный brand mark Option O (ascending sine-wave), масштаб 28px, subtle pulse
- В нижнем левом — крошечный точечный grid (24×24 px), opacity 0.04, плавает 12s loop

**Центральный визуал (kie.ai Veo 3.1):** 8-секундный ambient loop на заднем плане ПОЗАДИ текста (opacity 0.18, `mix-blend-mode: screen`):
- **Prompt:** isometric overhead view of a clean wooden desk, single laptop showing minimalist dashboard UI, soft warm key light from top-left, gentle ambient particles, no people, no text in UI, cinematic 5K, depth of field, slowly rotating camera
- **Aspect:** 16:9
- **Fallback (если Veo лагает):** статичный AVIF от 4o Image API того же prompt'а

**Микро-детали:**
- H1 буквы выкатываются с задержкой 60ms друг за другом (Framer Motion stagger)
- CTA — magnetic-cursor radius 120px на десктопе; на mobile — простой touch-target 56pt
- Mouse-hint глифа «↓» под CTA на 4-й секунде, исчезает на скролл

---

## Экран 2 — Боль 1 «Шесть вкладок и двенадцать переписок» (editorial, длинный)

**Цель:** узнавание. Учитель читает и думает «бл, это же про меня».

**Структура:**
- **Section label** (мелкий, mononspace): `01 / БОЛЬ`
- **H2** (h1 subdued, ~64px, сериф Georgia): `Каждое занятие — это шесть сервисов и двенадцать переписок.`
- **Body (3 параграфа, ширина 64ch, размер 19px):**

  Параграф 1: `Утром ты открываешь Telegram, потому что Анна написала «можем перенести на четверг?» — и теперь тебе нужно проверить, не записан ли уже кто-то на четверг. Лезешь в Excel. Excel-таблица показывает четверг 18:00 свободным, но цвет ячейки оранжевый — это значит, что Маша «возможно придёт», но точно она ещё не написала. Пишешь Маше. Маша отвечает через 40 минут.`

  Параграф 2: `Тем временем родители Пети уже два дня ждут счёт. Ты лезешь в третью вкладку — там у тебя шаблон счёта в Word. Открываешь файл, меняешь сумму, экспортируешь в PDF. Закидываешь PDF в Сбер. Получаешь номер счёта. Копируешь его в Telegram. Высылаешь родителю.`

  Параграф 3: `И всё это — ещё до того, как ты успел открыть учебник. Десять минут на одну переписку. Двенадцать переписок в день. Два часа в день — на то, что в нормальной системе должно занимать ноль.`

- **Pull-quote (вставка, левый рваный border):**
  > `«Я устаю не от уроков. Я устаю от того, что между уроками.»`

**Фон (Aceternity):** `Background Boxes` — слабоконтрастная сетка 32×32 ячейки, opacity 0.04, hover на ячейке зажигает её на 800ms. Создаёт ощущение «много чего происходит вокруг».

**Боковые акценты:** в правой колонке (sticky на скролле) — `01 / БОЛЬ` нумерация плюс маленький drift-loop из 4-5 иконок (telegram-bubble, excel-cell, pdf-file, sber-icon, calc-icon), opacity 0.5, медленно сдвигаются вверх. Это и есть «6 сервисов» — пользователь видит их боковым зрением, не нужно отдельной иллюстрации.

**Центральный визуал (kie.ai 4o Image):** статичная illustration на верхней правой трети экрана:
- **Prompt:** flat-lay photograph of a chaotic teacher desk seen from above, isometric perspective, scattered open notebook with handwritten numbers, smartphone showing telegram chat with "когда вам удобно?", small laptop showing colorful excel cells, calculator with digits, sticker notes pasted around, paper schedule with circles, single coffee cup, warm soft light, no people, no text labels except the visible chat bubble, photorealistic, shot on 35mm film, depth of field
- **Aspect:** 3:2
- **Файл:** `public/assets/landing-v3/illustrations/desk-chaos.avif`

**Скрол-триггер:** body параграфы fade-in сверху вниз с задержкой 200ms друг от друга. Pull-quote появляется со scale 0.95 → 1.0.

---

## Экран 3 — Боль 2 «А деньги-то где?» (editorial)

**Цель:** боль номер два — учитель не управляет своими доходами.

**Структура:**
- **Section label:** `02 / БОЛЬ`
- **H2:** `В конце месяца ты не можешь точно ответить: сколько ты заработал.`
- **Body (3 параграфа):**

  Параграф 1: `Часть переводов — на карту. Часть — наличкой после занятия. Часть — родители оплатили сразу пакет за четыре занятия вперёд, и ты теперь должен ученику эти четыре урока, а денег уже нет — они потрачены на квартплату.`

  Параграф 2: `Через три месяца ты не помнишь, кто оплатил февраль, а кто только январь. Не помнишь, у кого ещё остались уроки из пакета, а кто давно ушёл в минус. Помнишь только смутно — кажется, Маша должна, а Аня нет. Или наоборот.`

  Параграф 3: `Тогда ты садишься и две недели восстанавливаешь по чатам и переводам кто кому что должен. Делаешь это в декабре, чтобы хотя бы налоговую не подвести. И понимаешь, что половину январских доходов ты потерял — просто забыл записать.`

- **Inline-stat (Framer Motion NumberTicker):**
  ` ~₽` `14 700` `— столько в среднем "теряет в воздухе" репетитор за квартал, если не ведёт балансы. (наша оценка по разговорам с владельцами кабинетов.)`

  *(Цифру держим как hypothesis — owner поправит или подтвердит.)*

**Фон (Aceternity):** `Wavy Background` — тёплая warm-gradient волна, очень медленная (24s loop), edge-blur. Не на весь экран, только нижняя треть фона. Это и есть «тёплый акцент» darkrise-astro vibe.

**Боковые акценты:** в левой колонке (sticky) — `02 / БОЛЬ` плюс маленькое субтильное диаграммы «приход / расход» с floating bars (Framer Motion), opacity 0.3.

**Центральный визуал (kie.ai 4o Image):** на правой трети экрана:
- **Prompt:** close-up photograph of a paper notebook with handwritten messy financial notes in russian "Маша - 2 / Петя - 1 / Катя - 4", arrows crossed out and rewritten, pencil aside, several sticker notes with rouble amounts, calculator display showing partial number, soft window light from left, warm muted colors, no people, no clear text except the names list, shot on 35mm, slight grain
- **Aspect:** 3:2
- **Файл:** `public/assets/landing-v3/illustrations/messy-balance-book.avif`

---

## Экран 4 — Боль 3 «Сколько часов в неделю ты теряешь?» (short, punch)

**Цель:** punchline после двух длинных болей. Дать передохнуть и поставить вопрос ребром.

**Структура:**
- **Section label:** `03 / БОЛЬ`
- **H2** (clamp 56-96px, центрировано): `Сколько часов в неделю ты тратишь не на преподавание?`
- **Subtitle** (под H2, ~22px, секондарный): `Calendly, Telegram, Excel, Сбер, Word, Notes на айфоне. Шесть вкладок. И ты — между ними.`
- (Никакого body. Этот экран — пауза.)

**Фон (Aceternity):** `Spotlight` — мягкий радиальный лучик из верхнего левого угла, тёплый, освещает текст. Это намёк на «выход к свету» (сейчас будет переход к решению).

**Боковые акценты:** в нижней части экрана — тонкая горизонтальная прогресс-полоска (1px, opacity 0.3), которая заполняется на скролл. Это и есть «scroll progress indicator».

**Центральный визуал:** НЕТ. На этом экране только типографика. Текст крупный, дышит, экран пустой — это и есть его сила.

**Скрол-триггер:** H2 проявляется через Aceternity `Text Generate Effect` (по слову, ~80ms задержка между словами). Subtitle fade-in после полной появления H2.

---

## Экран 5 — Переход «Мы собрали для тебя» (мост)

**Цель:** объявление продукта. От боли к решению.

**Структура:**
- **Eyebrow:** `Что мы сделали`
- **H2** (clamp 48-84px, сериф/sans микс): `Один экран. Знает всё.`
- **Body** (короткий, 1 параграф):
  `Мы взяли только то, что репетитор реально открывает каждый день. Расписание, ученики, балансы, пакеты. Всё в одном кабинете — без рассыпанных Telegram-чатов, Excel-таблиц и шаблонов в Word.`
- **Inline-line (warm hint):** `Сделан специально под частного репетитора. Без лишнего, с самым необходимым.`

**Фон (Aceternity):** `Aurora Background` — переход палитры. На предыдущем экране — холодный, здесь начинается тёплый accent gradient (#C87878 → #E8A890). Медленно (12s loop).

**Боковые акценты:** субтильный grid из четырёх плашек («Расписание / Ученики / Балансы / Пакеты») возникает с боков, как намёк на бенто-grid экрана 6. Появляются через staggered Framer Motion.

**Центральный визуал (kie.ai 4o Image):** UI mockup — clean dashboard frame, тёмная тема, видны 4 module-карточки. Размер — на всю ширину контейнера.
- **Prompt:** clean minimalist dark dashboard UI screenshot, 4 module cards arranged in 2x2 grid labeled in russian "Расписание", "Ученики", "Балансы", "Пакеты", flat design, dark background `#0B0B0C`, warm accent `#C87878`, soft glow on active card, no people, no extra decoration, web app screenshot style, 5K, aspect 16:10
- **Aspect:** 16:10
- **Файл:** `public/assets/landing-v3/illustrations/dashboard-grid-preview.avif`

---

## Экран 6 — Что внутри (bento grid, 4 модуля)

**Цель:** показать конкретно — без длинного списка фич, через UI-демонстрацию.

**Структура:** Aceternity `Bento Grid` 2×2, четыре ячейки. В каждой — заголовок, короткий параграф, UI mockup (kie.ai screenshot), 3D-tilt на hover.

**Ячейка 1 — Расписание**
- **Заголовок:** `Расписание, которое видишь не только ты.`
- **Body:** `Слоты, которые ученик и его родитель видят в своём календаре. Перенос — две секунды. Конфликтов нет. Напоминание уходит автоматически за час.`
- **UI mockup (kie.ai 4o):** mini calendar grid widget UI screenshot showing 7 days, time slots colored as booked/free/pending, dark theme, ratio 4:3 — `public/assets/landing-v3/illustrations/feat-schedule.avif`
- **Framer:** card-tilt на hover (8deg max)

**Ячейка 2 — Ученики**
- **Заголовок:** `Карточка ученика — то, что ты обещал помнить.`
- **Body:** `Имя, уровень, цели, заметки про слабые места. Что разбирали на прошлом уроке. Что задал. Что готовить сегодня. Не в голове, а в одном месте.`
- **UI mockup (kie.ai 4o):** mini learner card UI — name, level "B1 Intermediate", notes, last lesson summary, dark theme — `public/assets/landing-v3/illustrations/feat-learner.avif`
- **Framer:** card-tilt

**Ячейка 3 — Балансы**
- **Заголовок:** `Кто кому должен — больше не в твоей голове.`
- **Body:** `Списали с пакета — автоматически. Пришла оплата — обновилось. Видишь сразу: у Пети ещё четыре урока, Маша должна за два.`
- **UI mockup (kie.ai 4o):** mini balance table UI — 4 students with +/− amounts in roubles, monospace numbers, dark theme — `public/assets/landing-v3/illustrations/feat-balance.avif`
- **Framer:** card-tilt + NumberTicker на числах баланса (счёт идёт вверх при scroll-into-view)

**Ячейка 4 — Пакеты и тарифы**
- **Заголовок:** `Пакеты на 4, 8, 16 уроков — без шаблонов в Word.`
- **Body:** `Создаёшь тариф один раз. Назначаешь ученику пакет — он автоматически списывается урок за уроком. История остаётся.`
- **UI mockup (kie.ai 4o):** mini package builder UI — duration slider, count input, price field, "Назначить ученику" button, dark theme — `public/assets/landing-v3/illustrations/feat-package.avif`
- **Framer:** card-tilt

**Фон (Aceternity):** `Grid Background` — equally-spaced точечный grid 24×24, opacity 0.04. Subtle.

**Боковые акценты:** в просвете между ячейками 1-2 и 3-4 — animated beam (Aceternity `Animated Beam`), который пересекает grid диагональю каждые 8 секунд. Это и есть «движение» без перегруза.

---

## Экран 7 — Безопасность и данные (editorial короткий)

**Цель:** USP — «твои данные у тебя». 152-ФЗ.

**Структура:**
- **Section label:** `04 / БЕЗОПАСНОСТЬ`
- **H2** (~56px, сериф Georgia): `Имена твоих учеников и их балансы — никуда не уходят.`
- **Body (2 параграфа):**

  Параграф 1 (актуализировано 2026-06-27, после включения Яндекс.Метрики): `Мы не продаём твои данные и не используем их для рекламы. На публичных страницах сайта работает Яндекс.Метрика для статистики посещаемости; в личном кабинете, на входе, регистрации и оплате сторонней аналитики нет. Плюс наш собственный счётчик кликов по кнопкам — без имён, без email, без сумм.`

  Параграф 2: `Согласия учеников на обработку персональных данных — фиксируются по правилам 152-ФЗ, со штампом времени, версии документа, IP-адресом и user-agent'ом. Если когда-то нужно будет показать налоговой или Роскомнадзору — вся история готова к выгрузке.`

- **Inline-bullets (мелким, под body):**
  - TLS на каждом соединении между тобой, нами и банком
  - Пароли хранятся в виде bcrypt-хэшей (никто, включая нас, не видит твой пароль)
  - Платёжные webhook'и подписаны HMAC — никто не может подделать «оплату пришла»
  - Доступы по сессии истекают через 7 дней, при выходе — отзываются мгновенно

**Фон (Aceternity):** `Background Beams with Collision` — два тонких луча сталкиваются в центре экрана раз в 12 секунд, остальное время — просто плывут. Это и есть «защита» как метафора.

**Боковые акценты:** в правой колонке — крошечный subtle padlock-glyph (16px, opacity 0.4), который раз в 8 секунд slightly pulse'ит.

**Центральный визуал:** нет. Этот экран — чистая типографика и доверие.

---

## Экран 8 — Цены (table, 3 тарифа)

**Цель:** показать тарифы как факт. Без давления.

**Структура:**
- **Eyebrow:** `Тарифы`
- **H2:** `Простая цена за активных учеников.`
- **Подзаголовок:** `Стартовый — навсегда. Базовый и Расширенный — когда у тебя становится больше учеников. Платишь только за активных.`

- **Pricing grid (3 карточки horizontal на десктопе, 1-column на мобайле):**

  **Карточка 1 — Стартовый**
  - Badge: нет
  - Цена: `0 ₽`
  - Период: `навсегда`
  - Лимит: `до 1 активного ученика`
  - Bullets:
    - Расписание и слоты
    - 1 пакет и 1 тариф (для знакомства)
    - Балансы и долги
    - История уроков
  - CTA: `Начать бесплатно`

  **Карточка 2 — Базовый**
  - Badge: нет
  - Цена: `300 ₽`
  - Период: `в месяц`
  - Лимит: `до 5 активных учеников`
  - Bullets:
    - Всё из «Стартового»
    - Пакеты и абонементы без лимита
    - Тарифы без лимита
    - Балансы и долги
  - CTA: `Подписаться`

  **Карточка 3 — Расширенный** (highlight + badge «Популярный», gradient outline)
  - Badge: `Популярный`
  - Цена: `800 ₽`
  - Период: `в месяц`
  - Лимит: `до 30 активных учеников`
  - Bullets:
    - Всё из «Базового»
    - Расширенные отчёты
    - Приоритетная поддержка
    - Прямые ответы оператора
  - CTA: `Подписаться`

- **Trust line под карточками:** `Без карты при регистрации. Оплата только при переходе на платный тариф.`

**Фон (Aceternity):** `Spotlight` — мягкий лучик подсвечивает центральную карточку (Расширенный).

**Боковые акценты:** на «Популярный» карточке — gradient border-animation (Aceternity `Border Beam`), 8 секунд loop, тонкая полоса бежит по периметру.

**Центральный визуал:** нет — цена сама по себе центральная.

**Микро-детали:**
- На hover на карточку — её тень углубляется + lift -2px
- Цифры цен appear через NumberTicker (`0 → 0`, `0 → 300`, `0 → 800`) при scroll-into-view

---

## Экран 9 — Конкурентный угол «Почему именно мы» (без называния)

**Цель:** объяснить почему не GetCourse, не Notion, не Excel — не называя имён.

**Структура:**
- **Eyebrow:** `Чем мы отличаемся`
- **H2** (~48px): `Сделан специально для тебя. Без лишнего.`

- **3-column compare-grid:**

  **Колонка 1 — «Тяжёлые системы»**
  - Заголовок (тусклый, secondary): `Тяжёлые LMS`
  - Body: `Сделаны для школ и больших групп. Тебе там нужно 10% функций — а платить надо за всё. И каждый раз чувствовать, что ты что-то не настроил.`

  **Колонка 2 — «Универсальные тулзы»**
  - Заголовок (тусклый): `Notion, Trello, таблицы`
  - Body: `Не знают, что такое урок, баланс и пакет. Каждый раз ты собираешь систему сам — потом она ломается, и ты собираешь её заново.`

  **Колонка 3 — «LevelChannel»** (highlight)
  - Заголовок (accent): `LevelChannel`
  - Body: `Собран только под частного репетитора. Все экраны — про то, как ты ведёшь учеников: расписание, балансы, пакеты. Без лишнего.`
  - **Tagline под body:** `Экономит время. Помогает создать систему. Упрощает жизнь.`

**Фон (Aceternity):** `Background Boxes` — тот же что и на экране 2 (rhyme — мы вернулись к "сетке хаоса", но теперь чтобы её "победить").

**Боковые акценты:** между колонками — тонкие vertical-rule'ы (1px, opacity 0.1).

---

## Экран 10 — Финальный CTA + Footer

**Цель:** последняя конверсия. Подытожить и подтолкнуть.

**Структура (CTA-блок):**
- **H2** (~72px, сериф): `Сворачиваем шесть вкладок в один кабинет.`
- **Подзаголовок** (~20px): `Стартовый — бесплатно, навсегда. Без карты. Один ученик включён.`
- **CTA primary** (большая, gradient outline, magnetic): `Забрать Стартовый →`
- **CTA secondary** (link под кнопкой): `Сначала посмотреть на тарифы` (anchor на экран 8)

**Фон (Aceternity):** `Background Beams with Collision` + edge spotlight снизу. Эпик-уровень, но не pergrузка.

**Боковые акценты:** brand mark Option O анимированный в правом нижнем углу (синусоида плывёт), как «здесь живёт LevelChannel».

**Скрол-триггер:** H2 проявляется по слову (Text Generate Effect ~120ms между словами), затем кнопка fade-in + scale 0.95 → 1.0 с задержкой 600ms.

---

**Footer (отдельный блок под CTA):**

4-column grid:

**Колонка 1 — Brand:**
- Brand mark (full variant, 140px wide)
- Tagline под: `Кабинет для частного репетитора.`

**Колонка 2 — Документы:**
- SaaS-оферта (`/saas/offer`)
- Условия процессинга (`/saas/processor-terms`)
- Политика конфиденциальности (`/privacy`)
- Согласие на обработку ПДн (`/consent/personal-data`)

**Колонка 3 — Реквизиты:**
- ИП {legalOperatorDisplay}
- ИНН: {legalOperatorTaxId}
- ОГРНИП: {legalOperatorOgrn}
- Р/С: {legalBankAccount}
- Банк: {legalBankName}
- БИК: {legalBankBik}

**Колонка 4 — Контакты:**
- Email (`mailto:{publicContactEmail}`)
- `Уже учишься? — Оплатить` (`/pay`)

Все ссылки — стандартный footer pattern (видели уже в Variant A/B/C scaffold'ах).

---

## Сводная таблица — анимация и ассеты по экранам

| # | Экран | Фон (Aceternity) | Side-motion (Framer) | kie.ai ассет |
|---|---|---|---|---|
| 1 | Hero | Background Beams | Brand mark pulse + point-grid drift | Veo 3.1 ambient loop (8s) |
| 2 | Боль 1 | Background Boxes | 6 service-icons drift | 4o Image desk-chaos (3:2) |
| 3 | Боль 2 | Wavy Background warm | Bars float | 4o Image messy-balance-book (3:2) |
| 4 | Боль 3 | Spotlight | Scroll progress bar | — |
| 5 | Переход | Aurora Background warm | 4 module-плашки stagger | 4o Image dashboard-grid-preview (16:10) |
| 6 | Что внутри | Grid Background | Animated Beam diagonal | 4o Image × 4 mini UI mockups |
| 7 | Безопасность | Background Beams with Collision | Padlock-glyph pulse | — |
| 8 | Цены | Spotlight | Border Beam на highlight-карточке | — |
| 9 | Конкуренты | Background Boxes (rhyme с экраном 2) | Vertical rules | — |
| 10 | CTA | Background Beams with Collision + edge spotlight | Brand mark sine-wave loop | — |

**Итого kie.ai генераций (с черновых промптов):**
- 1× Veo 3.1 video (8s ambient)
- 6× 4o Image illustration (3 болевых + 1 dashboard preview + 0 экран 6 заменяет 4 UI mockup'ами = 4 mockups)

**Total assets: 1 video + 6 images.**

---

## Конкретный план кодинга после этого скрипта

1. **`npm install framer-motion`** (наконец-то — это база Aceternity)
2. **`npx shadcn@latest init`** (Tailwind конфигурация под shadcn)
3. Поставить Aceternity-блоки (free tier через `npx shadcn add ...`): Background Beams, Background Boxes, Aurora Background, Wavy Background, Spotlight, Bento Grid, Border Beam, Animated Beam, Text Generate Effect, NumberTicker
4. Скрипт `scripts/kie-generate.mjs` гоняет промпты из этого script.md → kie.ai → сохраняет в `public/assets/landing-v3/illustrations/`
5. Собираю `/saas/v3` экран за экраном — каждый экран как отдельный `.tsx` файл в `components/saas/landing-v3/screens/`
6. Локально вижу в браузере. Ты ходишь по экранам, тыкаешь — переделываю конкретный

---

## Что я хочу от тебя следующим шагом

1. **Прочти 10 экранов выше** — поправь копирайт где звучит как AI / звучит фальшиво / надо дотянуть
2. **Цифру `~₽14 700`** на экране 3 — это моя hypothesis. Подтверди / поправь / убери цифру совсем
3. **Pull-quote на экране 2** «Я устаю не от уроков. Я устаю от того, что между уроками» — это моя выдумка под учительский голос. Если знаешь реальную фразу от твоих pilot-users — заменим
4. **Экран 4** (короткая боль 3) — норм пауза или вырезать? У тебя 10 экранов — можем сжать до 9
5. **Экран 9 (конкуренты)** — оставляем 3-column compare или один параграф?

Когда поправишь — я гоняю `scripts/kie-generate.mjs` с твоим утверждённым промптами + начинаю кодить `/saas/v3`.
