# teacher-learner-cabinet-note — заметка учителя в кабинете ученика

**Status**: BACKLOG — plan-doc only, no implementation. Self-paranoia
SIGN-OFF round 2/2 (Codex quota exhausted; user-approved §7 fallback).
**Created**: 2026-06-08.

## Decisions (locked round 1, 2026-06-08)

| Field | Decision | Rationale |
|---|---|---|
| Body length cap | 2000 chars | covers greetings + multi-paragraph instructions; matches DB CHECK |
| Link policy | free http/https (no whitelist, no proxy) | teacher already has Telegram/email phishing surface — UI disclaimer carries the trust gap; no open-redirect on our domain |
| Link count | 0-3 | 95-percentile use case (1 Quizlet + 1 Google Doc + 1 Zoom) |
| Notify channel in MVP | none — render-on-next-cabinet-load only | defer Web Push / email to a separate epic; reduces blast radius |
| Read receipt | none | defer; avoids `seen_at` race + extra column in MVP |
| Delete style | clear-in-place (empty body + empty links, row remains) | simpler audit + history; physical DELETE deferred |
| Multi-teacher rendering | inside each `TeacherBlock` | context obvious, no extra tab/click |

**Owner**: ivankhanaev. **Epic ID**: `tl-note`.

---

## 0. TL;DR

Учитель может оставить ученику небольшую заметку, которая показывается
на главной странице кабинета ученика под онбордингом. Use cases:
приветствие, указания перед уроком, ссылки на материалы, поздравления,
объявления о переносе занятий.

Однонаправленный канал учитель → ученик (ученик не отвечает в кабинете
— у него уже есть Telegram/email учителя).

Минимальная функциональная единица: `teacher_learner_notes (teacher_id,
learner_account_id, body_text, links_url[], updated_at, …)`. Plain text
тело + опционально 0-3 ссылки на материалы (отдельная колонка, не парсим
URL из тела во избежание XSS-сюрпризов). Per-pair scope.

Безопасность: тело — строго plain text, без markdown / HTML; ссылки —
typed-URL whitelist схем (http/https), целевые домены без ограничения,
но render через `<a rel="noopener noreferrer" target="_blank">` и без
auto-redirect через наш домен.

---

## 1. Что строим / не строим

### 1.1 Goals (in scope)

- Учитель в `/teacher/learners/[id]` редактирует заметку для конкретного
  ученика: тело + 0-3 ссылки.
- Ученик в `/cabinet` (или внутри своего TeacherBlock в мульти-учительском
  кейсе) видит карточку «Сообщение от Имя Учителя» с телом + ссылками.
- Учитель может стереть заметку — карточка исчезает у ученика.
- Аудит: каждое создание / редактирование / удаление пишется в
  `auth_audit_events` (`teacher.learner_note.upserted` / `.cleared`).
- Rate-limit на upsert (например, 30 в час на пару teacher×learner) —
  защита от random key-press загруза.

### 1.2 Non-goals (откладываем)

- Markdown / rich text / bold / italic / списки / изображения.
- Загрузка файлов / attachments.
- Push / email уведомление ученику об изменении.
- Реакции ученика, диалог, ответ в обратном направлении.
- История версий с rollback.
- Per-teacher broadcast (одно сообщение для всех учеников учителя).
  Если позже захотим — отдельным эпиком.
- Срочные / важные / pinned заметки. Заметка всегда одна на пару.
- Авто-перевод, авто-обнаружение языка, авто-saying.

### 1.3 Принципы

- **Plain text only**: тело — `text` без какого-либо markup. Ссылки —
  отдельная типизированная колонка, рендерятся как `<a>` элементы,
  но НЕ интерпретируются из тела. Это убивает XSS-вектор на корню.
- **Per-pair scope**: каждое сообщение принадлежит конкретной паре
  (teacher, learner). Учитель не может случайно показать одну запись
  всем — для каждого ученика отдельное действие.
- **Append-only audit**: тело и ссылки апдейтятся in-place (один row
  на пару), но каждое изменение пишет audit-event со снимком до/после
  для compliance / расследования жалоб.
- **Дешёвая операция, дорогой аудит**: основной flow — учитель часто
  правит, аудит копит. Это не платёжный SoT.

---

## 2. Архитектура

### 2.1 Data model

Новая таблица (мiг 0117):

```sql
create table teacher_learner_notes (
  teacher_account_id uuid not null
    references accounts(id) on delete cascade,
  learner_account_id uuid not null
    references accounts(id) on delete cascade,
  body_text text not null default '',
  links jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (teacher_account_id, learner_account_id),
  check (length(body_text) <= 2000),
  check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3)
);

create index teacher_learner_notes_learner_idx
  on teacher_learner_notes (learner_account_id);

-- updated_at auto-bump (BEFORE UPDATE trigger). Default at INSERT
-- comes from the column default; UPDATE pathways are app-mediated,
-- but the trigger guarantees consistency for direct admin scripts too.
create or replace function teacher_learner_notes_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger teacher_learner_notes_touch_updated_at
  before update on teacher_learner_notes
  for each row execute function teacher_learner_notes_touch_updated_at();
```

`links` JSONB — массив объектов `{ url: string, label: string }`, оба
≤200 символов (валидация на app-layer). url — `http://` или `https://`,
больше ничего не пускаем.

Empty body_text + empty links = пустая запись; SSR трактует как «нет
заметки», карточка не рендерится. Удаление = clear-in-place (см.
Decisions): DELETE-эндпоинт UPDATE'ит body+links на пустые значения,
сам row не удаляется. История upsert/clear копится в `auth_audit_events`.

### 2.2 API

**`PUT /api/teacher/learners/{learner_id}/note`**
- Auth: `requireTeacherWithCurrentSaasOfferConsent` (SSR-path gate
  достаточен; note edit не legal-state-affecting → mutation-path gate
  не требуется).
- Body: `{ body_text: string, links: { url, label }[] }`.
- Validation:
  - `body_text` ≤2000 ПОСЛЕ `.trim()` (на app-layer); DB CHECK
    `length(body_text) <= 2000` страхует прямые DB-вставки.
  - `links` ≤3.
  - Каждый `url`: парсится через `new URL()`; `protocol === 'http:'`
    или `'https:'`. Regex `^https?://` НЕ используем — `http:///\0attacker`
    проходит regex, но валится в `new URL()`.
  - Общая длина URL ≤200; `label` ≤80 ПОСЛЕ `.trim()`.
  - Все строки sanitized от CR/LF/NUL (см. `lib/email/sbp-claim-template.ts`).
- Authorization: `teacher_id` (из сессии) должен иметь активный
  `learner_teacher_links` (`unlinked_at IS NULL`). Иначе 403. Проверка
  AT WRITE TIME, не только при render.
- Rate-limit (через `takeRateLimit` в `lib/security/rate-limit.ts`):
  - `teacher-note:upsert:<teacher_id>:<learner_id>` — 30 / 60 min.
  - `teacher-note:upsert:<teacher_id>` — 120 / 60 min (anti-script-load).
- Idempotent: upsert one-row, returns the saved snapshot.
- Audit: `teacher.learner_note.upserted` (см. §3.2 — sat в
  `auth_audit_events` через `recordAuthAuditEvent`).

**`DELETE /api/teacher/learners/{learner_id}/note`**
- Clear-in-place: row остаётся с пустым body + empty links (см.
  Decisions). Физический DELETE не используем — упрощает audit.
- Auth: то же.
- Audit: `teacher.learner_note.cleared`.

### 2.3 SSR на /cabinet

Single-teacher learner (одна активная пара): на главной под
онбордингом, перед LessonsSection, рендерим карточку
`<LearnerTeacherNote>` если запись непустая.

Multi-teacher learner: внутри каждого `TeacherBlock` рендерим
`<LearnerTeacherNote>` для соответствующего учителя. Сейчас
TeacherBlock содержит контекст {teacherId, teacherName}, добавим
{note: ...}.

Карточка отображает:
- Иконку / аватар учителя (используем initial из profile.firstName).
- «Сообщение от Имя Учителя» (заголовок).
- Тело: `<p>` с `white-space: pre-wrap` для сохранения переносов.
- Ссылки: вертикальный список `<a href="..." target="_blank"
  rel="noopener noreferrer">{label}</a>`.
- Опциональная пометка «обновлено N дней назад» (формат как в
  payment-claims feed).

### 2.4 UI учителя

В `/teacher/learners/[id]` — карточка «Сообщение в кабинете ученика»:
- Textarea (макс 2000 симв, счётчик).
- 3 пары инпутов (label + URL) с кнопками «Добавить ссылку» / «Удалить».
- Кнопка «Сохранить» (disabled если ничего не менялось).
- Кнопка «Очистить заметку» (показывается если запись есть).
- Preview справа (опционально) — как ученик это увидит.

---

## 3. Security

### 3.1 Threat model

| Угроза | Митигация |
|---|---|
| XSS через тело | Plain text, рендер через React `{string}` (auto-escape). Никаких `dangerouslySetInnerHTML`. |
| XSS через URL ссылки | Sanitize: только http/https; рендер через React `href={string}` (auto-escape для атрибутов). |
| Phishing-redirect через наш домен | Нет server-side `/redirect?url=` — ссылка ведёт напрямую. |
| Open-redirect через `?ref=` | Same. |
| CSRF на PUT/DELETE | `enforceTrustedBrowserOrigin` + session-cookie auth (стандарт). |
| IDOR на чужого ученика | `learner_teacher_links` active gate; 403 если пары нет. |
| Cross-tenant leak (учитель Б видит заметку А) | PK + per-pair query; 403 если не их пара. |
| Спам-загрузка | Rate-limit 30/час на (teacher, learner). |
| DoS через размер | DB check ≤2000 + ≤3 ссылки. |
| Privacy leak: имя ученика → учитель пишет в body | Учитель уже знает имя; не leak. |
| Privacy leak: тело попадает в audit | НЕ пишем тело в audit, только метрики. |
| Privacy leak: учитель пишет «болезнь Маши...» — ученик потом смотрит | Это user-to-user comm; aud level. |
| Учитель пишет «пришли мне фото паспорта» (social engineering) | Вне зоны нашей ответственности; учитель уже может это сделать через Telegram. |
| Брутfest URL автодетекции из тела | Не делаем auto-linkify тела. Только typed links. |

### 3.2 Audit-event shape

Используем существующую `auth_audit_events` таблицу через
`recordAuthAuditEvent` (`lib/audit/auth-events.ts`). Таблица
email-bearing, event_type whitelisted через SQL CHECK + TS allowlist
с drift-guard тестом
(`tests/integration/auth/auth-audit-event-types-drift.test.ts`).

**Sub-PR A scope расширяется**, чтобы:

1. Миграция 0117 (или какая будет к моменту бранчинга) ALTER-нет
   `auth_audit_events_event_type_check` чтобы добавить
   `teacher.learner_note.upserted` и `teacher.learner_note.cleared`.
2. `AUTH_AUDIT_EVENT_TYPES` в `lib/audit/auth-events.ts` расширяется
   теми же двумя строками.
3. drift-guard test расширяется для покрытия новых event_type'ов.

Запись:

```ts
await recordAuthAuditEvent({
  eventType: 'teacher.learner_note.upserted',
  accountId: teacherAccountId,          // actor = учитель
  email: teacherEmail,                  // hashed inside the recorder
  clientIp,
  userAgent,
  payload: {
    target_learner_id: learnerAccountId, // в payload, т.к. column'ы нет
    body_len: 234,
    link_count: 1,
    body_hmac: '<HMAC-SHA256 of body using AUDIT_NOTE_HMAC_KEY>',
    links_host_set: ['quizlet.com'],
  },
})
```

Тело НЕ сохраняем. HMAC (НЕ голый SHA-256) защищает от cardinality-
атаки «у скольких учителей note = `Привет!`»; ключ берётся из
`AUDIT_NOTE_HMAC_KEY` (или переиспользует `TELEMETRY_HASH_SECRET` —
выберем в Sub-PR A).

### 3.3 Rate-limit

```
limit:teacher-note:upsert:<teacher_id>:<learner_id>
  → 30 / 60 min (sliding window)

limit:teacher-note:upsert:<teacher_id>
  → 120 / 60 min (anti-script-load на учителя)
```

### 3.4 Что НЕ делаем (явно)

- Не делаем `dangerouslySetInnerHTML` нигде.
- Не делаем server-side rendering tag'ов из user content.
- Не парсим body на ссылки / markdown / эмоджи-расширения.
- Не делаем preview по URL (нет fetch на чужие домены — SSRF
  defense).
- Не сохраняем в полнотекстовый индекс.

---

## 4. UX вопросы (для self-review)

1. **Кто видит заметку**: только активный учитель ученика (active
   `learner_teacher_links`) или все исторические? — **Решение**:
   только активные, иначе после смены учителя старая заметка может
   ввести в заблуждение.
2. **Один шаблон или per-pair полная свобода**: per-pair.
3. **Можно ли иметь несколько заметок** одновременно (anchor'ом, на
   разные даты)? — **Решение**: нет, одна заметка на пару. Все
   подзадачи рисуются в самой заметке.
4. **Может ли ученик скрыть/dismiss**? — **Решение**: нет, это not
   onboarding. Учитель удалит когда станет не актуально.
5. **Дата обновления показывается?** — **Решение**: да, относительная
   «обновлено вчера», «обновлено N дней назад». Помогает понять
   актуальность.
6. **Текст подсветка ссылки внутри тела (auto-linkify)?** — **Решение**:
   нет, чтобы НЕ создавать привлекательный XSS-вектор. Только typed
   links.

---

## 5. План реализации

### 5.1 Sub-PRs (в одной волне, ~1 день)

Финальный номер миграции определяется в момент бранчинга (currently
expected 0117; может стать 0118+ если другие эпики обгонят).

| Sub-PR | Scope |
|---|---|
| A | Mig 0117 (CREATE TABLE + ALTER auth_audit_events check) + lib/audit/auth-events.ts TS allowlist + drift-guard test + lib/teacher/learner-notes.ts (CRUD + validation + audit emit) + unit tests |
| B | `PUT /api/teacher/learners/[id]/note` + `DELETE` + integration tests (auth + IDOR + active-link gate + URL parse + rate-limit + audit-emit + cascade-delete on GDPR) |
| C | UI учителя `/teacher/learners/[id]` (карточка editor с textarea + 3 link rows + counter + a11y label/aria) + RTL тесты |
| D | UI ученика — `<LearnerTeacherNote>` компонент + интеграция в `/cabinet` (single-teacher: под онбордингом перед LessonsSection) + TeacherBlock (multi-teacher: внутри блока) + bulk-fetch `listNotesForLearner(learnerId)` чтобы избежать N+1 |
| E | Documentation + plan-doc SHIPPED-flip + README/SECURITY обновление если новый env var (`AUDIT_NOTE_HMAC_KEY`) |

### 5.2 Test coverage matrix

Каждый Sub-PR владеет своими тестами; ни один Sub-PR не shipped без
зелёного релевантного срез теста.

- Unit (Sub-PR A):
  - `lib/teacher/learner-notes.ts`: upsert, clear, validation (length,
    URL scheme через `new URL()`, link count, trim, sanitize CR/LF/NUL),
    happy + edge.
  - HMAC хеширование body детерминированно при одинаковом ключе.
- Integration (Sub-PR B):
  - `PUT` happy path; 403 на не-свою пару; 403 на отлинкованного
    ученика (unlinked_at IS NOT NULL); 422 на длинный body / бад-URL
    (`javascript:`, `data:`, `http:///` malformed); 429 на rate-limit
    (per-pair + per-teacher); audit-row проявляется в `auth_audit_events`.
  - `DELETE` happy path → row остаётся с пустыми полями, не удаляется
    физически; audit-row.
  - GDPR cascade-delete: удалить учителя → note удалена; удалить
    ученика → note удалена.
  - drift-guard test расширен на два новых event_type.
- E2E / Playwright (Sub-PR D):
  - Учитель `/teacher/learners/[id]` пишет тело + ссылку → save → ученик
    в инкогнито-сессии видит карточку.
  - Учитель clear → ученик NOT видит.
  - Multi-teacher: ученик с 2 учителями видит обе карточки в правильных
    teacher-блоках.
  - Click на ссылку → opens new tab, `target="_blank" rel="noopener noreferrer"`.
- Security (Sub-PR B + D):
  - XSS body: `<script>alert(1)</script>` → отображается как plain text.
  - XSS label: same.
  - URL injection: `javascript:alert(1)` → 422.
  - URL: `data:text/html,<script>` → 422.
  - URL: `vbscript:` → 422.
  - URL: `file:///etc/passwd` → 422.
  - URL: `http://chosen.attacker/path?<embed>` → 200 (params не валидируем).
  - URL: `http://` (no host) → 422.
  - Long URL >200 → 422.
  - Long label >80 → 422.
- A11y (Sub-PR C + D):
  - textarea с `<label for="...">` + `aria-describedby` для counter.
  - link inputs paired with semantic labels.
  - card на ученике с `role="region"` + `aria-label="Сообщение от <имя>"`.

---

## 6. Открытые вопросы (закрыты round 1)

Все 7 вопросов закрыты в Decisions-блоке вверху документа. Записаны
2026-06-08.

---

## 7. Plan-paranoia self-review checklist (round 1)

- [x] Все 4 UI surface (учитель list, учитель detail, ученик single,
      ученик multi) согласованы — см. §2.3, §2.4.
- [x] Threat model покрыта — см. §3.1.
- [x] Audit-event shape согласован: используем `auth_audit_events`
      (та же таблица что и в PR #552 audit-encryption wave),
      event_type'ы `teacher.learner_note.upserted` / `.cleared`.
- [x] Rate-limit namespace зашит через `lib/security/rate-limit.ts`
      (см. §3.3 — два уровня, per-pair + per-teacher).
- [x] Существующая `learner_teacher_links` не нуждается в правке —
      SSR gate использует `unlinked_at IS NULL` как короткое замыкание.
- [x] `auth_audit_events.payload jsonb` вмещает форму §3.2 (≤500 bytes
      на event — body_len, link_count, body_hash, links_host_set).
- [x] Migration 0117 номер свободен (последняя на main — 0116; PR #553
      не вводит 0117).

### Edge cases (round 1 self-review)

1. **Линк teacher↔learner стал inactive** (учитель отлинковал ученика):
   SSR проверяет `unlinked_at IS NULL` в `learner_teacher_links` ПЕРЕД
   render'ом заметки. Pre-existing запись остаётся в таблице (cascade
   не сработал — это разные строки), но не показывается.
2. **Линк восстановили** (relink): запись снова видна, как если она и
   не пропадала. Это feature: учителю не нужно переписывать заметку.
3. **Concurrent edit с двух tab'ов**: last-write-wins. Audit видит оба
   upsert'а. MVP допустимо. Optimistic-concurrency (`If-Match` по
   `updated_at`) deferred.
4. **Trim перед валидацией**: `body_text` и каждый `label` `.trim()`
   ПЕРЕД length-check. Учитель не сможет обойти лимит пробелами.
5. **Пустое тело + 1 ссылка = валидный note** (это «вот тебе ссылка»).
   Пустое тело + пустые ссылки = clear-in-place (запись остаётся,
   карточка не рендерится).
6. **Empty label**: запрещён, 422. Если учитель не вводит label —
   client автоматически использует hostname URL'а как label (UX-fallback).
7. **URL длина >200**: 422 (защита от data-URI DoS). label длина >80:
   422.
8. **DB CHECK constraint на jsonb структуру**: 2000-char ограничение
   зашито в DB, link count тоже. Внутренняя структура (`url`+`label`)
   валидируется на app-layer; этого достаточно, бо writes идут только
   через наш PUT route.
9. **GDPR delete на ученика**: cascade-delete заметок через FK
   `on delete cascade`. OK.
10. **GDPR delete на учителя**: same.
11. **i18n**: тело на любом языке; UI-обёртка `<заголовок>` только
    на русском (платформа РФ).
12. **Длина в jsonb hex** не считаем — каждый link максимум 200+80+8
    overhead = ~300 байт; 3 link = 900 байт; + body 2000 = ~3 КБ на
    запись. Acceptable.
13. **Disabled-account (учитель `accounts.disabled_at IS NOT NULL`)**:
    SSR-gate в ученическом кабинете НЕ показывает заметку от
    disabled-учителя. PUT-route также 403 если teacher.disabled_at IS
    NOT NULL (хотя `requireTeacherWithCurrentSaasOfferConsent` уже
    проверяет — verify в Sub-PR B).
14. **API status codes**: 422 для validation (длина / scheme / format),
    403 для auth/IDOR, 429 для rate-limit, 200 для success. Совпадает
    с SBP epic pattern.
15. **WCAG/CSP**: card на ученике использует существующий .card
    класс из `globals.css` (не inline style для card frame); textarea
    + link inputs используют `var(--text)` / `var(--bg)` токены.
    Никаких `style-src 'unsafe-inline'` mod'ов CSP.

---

## 8. Ожидаемая ценность

- Закрывает job-to-be-done «учитель хочет связь без переключения в
  Telegram / email» для оперативных оповещений.
- Усиливает feeling of presence учителя в кабинете ученика (учитель
  не где-то там, а здесь — пишет, ведёт, направляет).
- Снижает количество забытых указаний (учитель пишет один раз, ученик
  видит каждый раз когда заходит).
- Базовый surface для будущих расширений (broadcast, шаблоны и т.д.)
  без необходимости пересмотра data model.
