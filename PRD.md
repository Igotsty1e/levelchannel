# 📄 PRODUCT REQUIREMENTS DOCUMENT (HISTORICAL)

> Этот документ описывает первую версию лендинга.
> Текущая техническая реализация уже ушла дальше:
> сайт работает на серверном `Next.js`, а оплата и security-контур описаны в
> [README.md](/Users/ivankhanaev/LevelChannel/README.md),
> [ARCHITECTURE.md](/Users/ivankhanaev/LevelChannel/ARCHITECTURE.md),
> [SECURITY.md](/Users/ivankhanaev/LevelChannel/SECURITY.md) и
> [PAYMENTS_SETUP.md](/Users/ivankhanaev/LevelChannel/PAYMENTS_SETUP.md).

## LevelChannel — Landing Page

---

# 🧠 1. Product Overview

**Product:** LevelChannel Landing Page
**Тип:** Конверсионный лендинг
**Модель:** Индивидуальные онлайн-занятия по английскому (1:1)
**Цель:** Генерация лидов через Telegram

---

# 🎯 2. Goals & Metrics

## North Star

**Leads per 100 visitors**

---

## Метрики

| Metric          | Target |
| --------------- | ------ |
| Conversion Rate | 5–10%+ |
| Telegram CTR    | >10%   |
| CTA Click Rate  | >15%   |
| Scroll Depth    | >60%   |

---

# 👤 3. Target Audience

* 18–40 лет
* специалисты (IT, бизнес, продукты и др.)
* цели:

  * экзамены (IELTS и др.)
  * работа / международка
  * разговорный английский

---

# 💡 4. Value Proposition

> Индивидуальный английский под конкретную цель
> с измеримым результатом

---

# 🧭 5. User Flow

```
Landing → Hero → Trust → UseCases → Results → CTA → Telegram → Диалог
```

---

# 🧩 6. Page Structure (Strict Order)

```
Header  
Hero  
TrustStats  
UseCases  
Process  
Results  
Teacher  
Pricing  
Payment  
FinalCTA  
Footer  
```

---

# ⚙️ 7. Core Functionality

---

## 7.1 Navigation

* sticky header
* smooth scroll
* anchor: `#cta`

---

## 7.2 CTA System

### Основной CTA (везде):

**Написать в Telegram**

---

## Ссылка:

```
https://t.me/anastasiia_englishcoach
```

---

## Размещение CTA:

* Hero
* Results
* Final CTA
* Header

---

## Поведение:

* открытие в новой вкладке
* hover эффект
* иконка Telegram (опционально)

---

## ❌ 7.3 Form

Форма полностью отсутствует.

Запрещено:

* любые input поля
* сбор данных
* хранение данных

---

# 💳 8. Payment

* способ: **СБП**
* интеграция: CloudPayments (в будущем)

---

## Требования:

* сайт не хранит платёжные данные
* только редирект / инструкция

---

# 🎨 9. UX/UI Requirements

---

## Стиль:

* минимализм
* premium
* тёмная тема

---

## Цвета:

* background: #0B0B0C
* text: #FFFFFF
* secondary: #A1A1AA
* accent: gradient (purple → blue)

---

## Typography:

* H1: 36–48px
* H2: 24–32px
* body: 16–18px

---

## Spacing:

* 8px grid
* section padding:

  * desktop: 80px
  * mobile: 40px

---

# 🧱 10. Content Specification

---

## 10.1 Header

* логотип: **LevelChannel**
* CTA: Написать в Telegram

---

## 10.2 Hero

### H1:

Английский под вашу цель — от экзамена до работы с иностранными клиентами

---

### Subheading:

Индивидуальные занятия 1:1
8 лет опыта и более 10 000 часов преподавания

---

### Bullets:

* Подготовка к IELTS и экзаменам
* Английский для работы
* Разговорный английский

---

### CTA:

**Написать в Telegram**

---

## 10.3 TrustStats

* 8 лет преподавания
* 10 000+ часов
* 1:1 формат
* международный опыт

---

## 10.4 UseCases

* Экзамены
* Работа
* Разговорный

---

## 10.5 Process

1. Определение цели
2. Индивидуальный план
3. Занятия 1:1
4. ДЗ + обратная связь

---

## 10.6 Results (кейсы)

1. IELTS 4.5 → 6.5
2. Экзамен за 6 недель
3. Работа (B2 → оффер)
4. Разговорный (3 месяца)
5. Нетворкинг (B1 → B2)

---

CTA:
**Хочу такой же результат → Telegram**

---

## 10.7 Teacher

Анастасия
8 лет опыта
10 000+ часов
международный опыт

---

## 10.8 Pricing

* 60 минут — 3500 ₽
* 90 минут — 5000 ₽

---

## 10.9 Payment

Оплата через СБП
Быстро и без комиссии

---

CTA:
**Написать в Telegram**

---

## 10.10 Final CTA

Заголовок:
Начните обучение под свою цель

---

Кнопка:
**Написать в Telegram**

---

# 🎞 11. Animations

* fade-in при скролле
* staggered появление
* hover эффекты

---

# ⚡ 12. Performance Requirements

* TTI < 2s
* LCP < 2.5s
* CLS < 0.1

---

# 📊 13. Analytics

## Events:

| Event          | Trigger |
| -------------- | ------- |
| page_view      | load    |
| cta_click      | click   |
| telegram_click | click   |
| scroll_50      | scroll  |
| scroll_90      | scroll  |

---

# 🧾 14. LEGAL

---

## 14.1 Footer

Содержит:

* Реквизиты
* Публичная оферта
* Политика конфиденциальности

---

## 14.2 Реквизиты

```
Индивидуальный предприниматель Фирсова Анастасия Геннадьевна  

ИНН: 673202755730  

Расчётный счёт: 40802810720000971101  

Банк: ООО "Банк Точка"  

БИК: 044525104  

Корреспондентский счёт: 30101810745374525104  

Город банка: г. Москва  
```

---

## 14.3 Политика конфиденциальности

URL: `/privacy`

---

### Текст:

```
Сайт не собирает и не хранит персональные данные пользователей.

Связь осуществляется через Telegram, где обработка данных регулируется политикой соответствующего сервиса.

Платежи обрабатываются через сторонние платёжные системы.
```

---

## 14.4 Публичная оферта

URL: `/offer`

---

Содержит:

* описание услуги
* формат (1:1 онлайн)
* стоимость (3500 / 5000 ₽)
* порядок оплаты (СБП)
* условия оказания

---

# ⚠️ 15. Constraints

* не добавлять формы
* не хранить данные
* не добавлять другие способы оплаты
* не менять тексты
* не перегружать UI

---

# 📱 16. Mobile Requirements

* mobile-first
* кнопки ≥44px
* читаемость

---

# 🧪 17. QA Checklist

* [ ] все CTA ведут в Telegram
* [ ] нет форм
* [ ] Telegram работает
* [ ] есть реквизиты
* [ ] есть оферта
* [ ] есть privacy
* [ ] mobile корректен
* [ ] нет лагов

---

# 🚀 18. Launch Plan

1. Deploy (Vercel)
2. Проверка Telegram
3. Проверка mobile
4. Проверка аналитики
5. Запуск
