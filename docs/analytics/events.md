# Event catalog

> Source of truth: `lib/analytics/registry.ts` (Zod schemas).

Naming:
- **snake_case**
- Действия → past tense: `signup_completed`, `package_clicked`
- Views → present: `page_view`
- Properties — snake_case keys

PII rules (Zod-enforced на сервере):
- ❌ email, phone, full name, payment card data, free-text user input
- ✅ event-shape data (tier, package_id, error_code, etc.)

---

## Universal

### `page_view`
Fired automatically by `<TrackingProvider />` (mounted in `app/layout.tsx`) on `pathname + searchParams` change.

**Skipped paths**: `/admin/*`, `/_next/*`, `/api/*` (см. `PAGE_VIEW_BLOCKLIST`).

**Properties**: `{ title?: string }` (document.title).

**Use cases**: page funnels, traffic distribution.

---

## Landing-v3 (главная)

### `hero_cta_clicked`
Клик по hero CTA. **Props**: `{ cta: 'primary_start_free' | 'secondary_see_pricing' }`.

### `pricing_tier_clicked`
Клик по tier-карточке в pricing-секции. **Props**: `{ tier: 'free'|'basic'|'pro', tier_name: 'Стартовый'|'Базовый'|'Расширенный' }`.

### `integrations_link_clicked` *(не инструментирован в Phase 3)*
**Props**: `{ target: 'google_calendar'|'telegram'|'email'|'digest' }`.

### `pullquote_visible` *(не инструментирован в Phase 3)*
Pullquote-секция вошла в viewport (intersection observer).

### `multiplatform_visible` *(не инструментирован в Phase 3)*
Multiplatform-секция вошла в viewport.

### `security_link_clicked` *(не инструментирован в Phase 3)*
Клик «как мы это делаем» в security-секции.

### `footer_link_clicked` *(не инструментирован в Phase 3 — footer Server Component)*
**Props**: `{ target: string }` — URL цели.

---

## SEO learn pages (`/saas/learn/*`)

### `seo_cta_clicked` *(не инструментирован в Phase 3)*
**Props**: `{ page: string, cta: 'open_cabinet'|'see_pricing' }`.

---

## Auth

### `signup_form_focused` *(не инструментирован в Phase 3)*
Поле формы регистрации получило focus. **Props**: `{ field: 'email'|'password'|'role' }`.

### `signup_submit_started`
Submit формы регистрации (до server response). **Props**: `{ role: 'teacher'|'learner' }`.

### `signup_completed`
Server 200 OK на register. **Props**: `{ role: 'teacher'|'learner' }`.

### `signup_failed`
Server вернул не-200. **Props**: `{ reason: string }` (error code или 'unknown').

### `login_*` *(не инструментирован в Phase 3 — `login_submit_started`/`login_completed`/`login_failed` те же паттерны)*

---

## Subscription (учитель)

### `subscription_plan_clicked`
Клик «Подписаться» на pro/basic. **Props**: `{ tier: 'basic'|'pro' }`.

### `payment_widget_opened`
CloudPayments widget открыт (после server-side intent). **Props**: `{ surface: 'teacher_subscription'|'cabinet_packages'|'pay', tier?, amount_rub? }`.

---

## Cabinet packages (ученик)

### `package_clicked` *(не инструментирован в Phase 3)*
Клик по карточке пакета. **Props**: `{ package_id: string, amount_rub: int }`.

### `buy_clicked`
Клик «Купить» на пакете. **Props**: `{ package_id: string }`.

---

## /pay (Анастасия legacy)

### `plan_selected` *(не инструментирован в Phase 3)*
**Props**: `{ plan_id: string }`.

### `pay_clicked` *(не инструментирован в Phase 3)*
**Props**: `{ plan_id: string, amount_rub: int }`.

---

## /anastasiia landing

### `anastasiia_cta_clicked` *(не инструментирован в Phase 3)*
**Props**: `{ cta: 'record_lesson'|'see_pricing'|'see_offer' }`.

---

## UX events *(не инструментированы в Phase 3 — на Phase 6)*

### `form_field_focused`
**Props**: `{ form: string, field: string }`.

### `form_submit_failed`
**Props**: `{ form: string, error_code: string }`.

### `scroll_depth`
Throttled: фаерится на 25/50/75/100% scroll до bottom. **Props**: `{ depth: '25'|'50'|'75'|'100' }`.

### `time_on_page`
Фаерится на `pagehide` + `visibilitychange`. **Props**: `{ seconds: int }`.

---

## Когда добавлять событие

1. Зарегистрируй в `lib/analytics/registry.ts` (Zod schema).
2. Опиши здесь.
3. Импортируй `track()` и вызови.
4. Tests/CI: добавь pull-request чекбокс «обновил registry + docs».

> ⚠️ Server-side: registry validates на ingest. **Unknown event → dropped silently** (no 400, не ломаем клиента). Sentry capture'ит warning.
