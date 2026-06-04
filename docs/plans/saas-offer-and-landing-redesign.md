# SaaS оферта + Tier-1 landing redesign (2026-05-30 — owner-requested)

**Status:** DRAFT — plan-paranoia rounds 1-7 closed; **round 8 BLOCK on 2026-06-04 with 6 BLOCKERs + 1 WARN (see §0ab)**. 6 BLOCKERs + 4 WARNs (r1) → 3 BLOCKERs + 5 WARNs (r2) → 5 BLOCKERs + 3 WARNs (r3) → 5 BLOCKERs + 2 WARNs (r4) → 3 BLOCKERs + 2 WARNs + 1 INFO (r5) → 2 BLOCKERs + 1 WARN (r6) → 1 BLOCKER + 2 WARNs + 1 INFO (r7) → 6 BLOCKERs + 1 WARN (r8 — NOT yet closed). Rounds 1-7 closures applied inline; round-8 findings recorded but closures deferred. All running off-protocol per saas-pivot 32-round precedent.
**Author:** Claude (orchestrator-mode).
**Owner context:** chat 2026-05-30. После SaaS-pivot Epic 8 + Codex restore of `/` (Анастасия 1:1 lessons) and `/saas` (teacher SaaS landing). Owner: текущий `/saas` "выглядит как говно" → Tier-1 редизайн. Отдельная задача: новая **SaaS оферта** (отличная от English-lessons оферты на `/offer`), покрывающая Free/Mid/Pro/Operator-managed тарифы + recurrent subscription + ПД-operator-роль.

> Companion docs:
> - `docs/plans/saas-pivot-master.md` (SHIPPED) — money flow + plan tier definitions.
> - `docs/content-style.md` — copywriting foundation (will be extended in Epic SAAS-2-DEFERRED).
> - `docs/design-system.md` — token foundation (Tier-1 redesign extends).
> - `~/.claude/skills/legal-rf-router/BASE_LEGAL_RF.md` — legal hierarchy of sources + CASE_PACKET schema.
> - `docs/critical-path.md` — 29-file inventory. **`lib/admin/operator-settings.ts` (item #21) IS on the list** — bundle PR therefore requires full `Codex-Paranoia: SIGN-OFF round N/3` (round-6 BLOCKER#2 closure; verified §0z + §6).

## 0. Plan-paranoia gate

This file MUST go through `/codex-paranoia plan` rounds 1-3 BEFORE Epic-A or Epic-B opens.

Sub-epics A (legal оферта) and B (Tier-1 redesign) are decomposed below. Epic A SIGN-OFF is independent of Epic B; both inherit this plan-doc's SIGN-OFF.

Per company contract (`~/.claude/CLAUDE.md §"Юридические вопросы"`), the legal pipeline routes through `legal-rf-router` first. Router decides which downstream agent owns the draft (most likely `legal-rf-commercial`) and whether `legal-rf-qa` partner-level review is mandatory before publication. This plan-doc only orchestrates the technical wrapper around the legal content; **all legal conclusions** (operator-of-ПД role consequences, refund clause shape, recurrent terms, jurisdiction details, consent gate semantics, downstream consequences for teacher write surfaces on learner email) are owned by the legal-rf stack.

## 0z. Existing surface inventory

Per company contract. NEW = create; EXTEND = touch existing; KEEP = unchanged.

| Surface | Status | Existing-surface grep check |
|---|---|---|
| `/offer` route | KEEP (English-lessons оферта for ИП Фирсова Анастасия) | exists at `app/offer/page.tsx`. NOT touched (legal content unchanged; only the wordmark asset may swap — see Sub-B.1). |
| `/saas/offer` route | NEW | grep `app/saas/offer` → does not exist. NEW route renders the persisted DB version (per owner Q-6). |
| `/saas-offer-accept` route | NEW (round-4 BLOCKER#3 + WARN#6 closure) | grep `app/saas-offer-accept` → does not exist. NEW TOP-LEVEL route (NOT under `/teacher/**` — would re-enter the same gate and infinite-loop). Renders existing оферта `body_md` from DB + checkbox + submit. Calls own auth check (mirror `requireTeacherAndVerified`). |
| `/api/teacher/saas-offer-accept` route | NEW (round-4 BLOCKER#4 + WARN#6 closure) | grep `app/api/teacher/saas-offer-accept` → does not exist. POST handler protected by `requireTeacherAndVerified` from `lib/auth/guards.ts:164` (NOT `requireAdminRole` — a regular teacher is not admin). Writes second `saas_offer` consent row idempotently. |
| `/saas-offer-awaiting` route | NEW (round-9 BLOCKER#1 closure) | grep `app/saas-offer-awaiting` → does not exist. NEW top-level page rendered when `evaluateSaasOfferGate` returns `awaiting_publication`. Content: "Платформа обновляет SaaS-оферту. Возвращайтесь чуть позже." Auto-refresh every 60s via meta refresh OR client-side polling. No interactive controls (the user can do nothing; the operator must publish v1). Own minimal layout (no `<SiteHeader />` teacher chrome). Anonymous → `/login`; non-teacher → role-appropriate redirect; teacher with `ok` verdict → `/teacher`; teacher with `consent_required` verdict → `/saas-offer-accept`. Without this route, the `redirect('/saas-offer-awaiting')` in `app/teacher/layout.tsx` 404s a teacher caught in the operator-flipped-flag-before-publishing-v1 window. |
| `lib/teacher-telegram-bind/actions.ts` (round-9 BLOCKER#2) | EXTEND | Currently `bindTeacherTelegramAndCreateChannel` at line 62 + `unbindTeacherTelegram` at line 117 do inline `roles.includes('teacher')` checks. These are teacher-side mutators reachable via server actions (NOT under `/api/teacher/**`). Add the saas_offer consent gate ALONGSIDE the existing role check at both call-sites — same `evaluateSaasOfferGate(account.id)` invocation; on `consent_required` or `awaiting_publication`, return an error result (server action error states; UI surfaces a banner directing the teacher to `/saas-offer-accept`). |
| `app/api/telegram/webhook/route.ts` teacher-branch consume path (round-9 BLOCKER#2) | EXTEND | Lines 154 + 205 enter the teacher-bind consume path inside the public webhook (not behind cabinet auth). Adding the gate here is delicate (the request comes FROM Telegram, not the teacher's browser session). The right rule: a teacher who tries to consume a bind code via Telegram while their `saas_offer` consent is missing/outdated → consume FAILS with a Telegram message "Завершите подтверждение SaaS-оферты в кабинете LevelChannel". The teacher_account_id is known from the bind row, so `evaluateSaasOfferGate(teacherAccountId)` is callable without a session. Inline the verdict check before `consume` mutation. |
| `app/saas/page.tsx` | EXTEND | exists (Codex restore `648868b`). Currently `noindex` (lines 17-23). Tier-1 redesign rebuilds its hero/sections/footer; metadata stays `noindex` until launch gate (§3.5) flips. |
| `components/home/teacher-landing-client.tsx` | REPLACE | exists. Tier-1 redesign supersedes; new `components/saas/saas-landing-tier1.tsx` + old removed. |
| `lib/auth/consents.ts` `ConsentKind` allowlist | EXTEND | currently `personal_data \| offer \| marketing_opt_in \| parent_consent` (line 5-9). NEW value: `saas_offer`. |
| `lib/legal/versions.ts` `LegalDocKind` allowlist | EXTEND | currently `offer \| privacy \| personal_data` (line 13). NEW value: `saas_offer`. |
| `app/api/admin/legal/versions/route.ts` admin API | EXTEND | `ALLOWED_KINDS` Set at line 20-24 lists only 3 kinds; add `saas_offer`. POST error message at line 76 + GET error message at line 43 also list the 3 kinds explicitly — update both strings. |
| `app/admin/(gated)/legal/versions-manager.tsx` admin tabs | EXTEND | `KINDS` array at line 13-21 lists only 3 entries; add `{ kind: 'saas_offer', label: 'SaaS-оферта', humanPath: '/saas/offer' }`. The `Props.initial: Record<LegalDocKind, ...>` shape (line 24) makes `LegalDocKind` extension compile-mandatory for the parent. |
| `app/admin/(gated)/legal/page.tsx` admin page (REQUIRED, not "verify only") | EXTEND | line 26-30 fetches versions for the 3 kinds explicitly via `Promise.all([listLegalVersions('offer',...), ('privacy',...), ('personal_data',...)])`; MUST add 4th call for `'saas_offer'`. Line 52-54 passes the result to `<LegalVersionsManager initial={{ offer, privacy, personal_data: ... }} />` — extend to include `saas_offer` key. Without this edit, TypeScript breaks on `Record<LegalDocKind, ...>` exhaustiveness. |
| `app/legal/v/[id]/page.tsx` public version history (REQUIRED, not "verify only") | EXTEND | `KIND_LABEL` const at line 9-13 lists only 3 entries → add `saas_offer: 'SaaS-оферта'`. `KIND_LIVE_PATH` at line 14-18 → add `saas_offer: '/saas/offer'`. Without these edits, the fallback `?? v.docKind` at line 41+51 renders the raw enum string in user-visible UI. |
| `migrations/0096_saas_offer_doc_kind.sql` | NEW (single concern) | extends `legal_document_versions.doc_kind` CHECK constraint AND `account_consents.document_kind` CHECK constraint with `saas_offer`. NO other table changes (mig 0095 was last; next slot is 0096). |
| `scripts/legal-pipeline-check.sh` | EXTEND (round-2 BLOCKER#3 + round-7 WARN#2 closure) | currently `LEGAL_PATHS` at line 32-36 lists 3 page files; `LEGAL_PREFIXES` at line 39-49 covers `lib/legal/`, `docs/legal/`, `app/offer/`, `app/privacy/`, `app/consent/`. Add to `LEGAL_PATHS`: `app/saas/offer/page.tsx`, `app/saas-offer-accept/page.tsx`. Add to `LEGAL_PREFIXES`: `app/saas/offer/`, `app/saas-offer-accept/`, `app/api/teacher/saas-offer-accept/`. Without this, any future edit to the SaaS оферта routes OR the teacher accept interstitial OR the POST handler bypasses the `Legal-Pipeline-Verified:` trailer guard. Lands in Sub-A.2-3-5 bundle so the guard exists BEFORE the new files do. |
| `docs/legal-pipeline.md` | EXTEND (round-3 WARN#8 + round-7 WARN#2 closure) | the doc's "Protected scope" table at line 18-25 lists existing 3 page files + `lib/legal/**`, `docs/legal/**`, `app/{offer,privacy,consent}/**`. Add three rows: `app/saas/offer/page.tsx` (Public SaaS оферта), `app/saas-offer-accept/page.tsx` (Existing-teacher SaaS оферта acceptance interstitial), `app/api/teacher/saas-offer-accept/route.ts` (Server-side consent capture for the interstitial). Doc + .sh stay in sync. |
| `tests/integration/setup.ts` re-seed | EXTEND (round-3 WARN#7 + round-8 INFO#4 closure) | currently lines 67-81 re-seed `legal_document_versions` for `offer`, `privacy`, `personal_data` only. **The migration seed (mig 0096) is `v0-placeholder-do-not-accept`** — that's the placeholder the gate REJECTS. The integration fixture re-seed adds a SEPARATE post-publication baseline `saas_offer v1` row (NOT mirroring the migration, but simulating the post-admin-publish state). Test scenarios that need to verify the placeholder-only path explicitly DELETE the `v1` row first. This explicit separation prevents "placeholder vs publication" confusion downstream. |
| `app/register/page.tsx` + `app/api/auth/register/route.ts` | EXTEND | see §3.6 consent matrix below for the authoritative per-flow contract. Current state: `body.personalDataConsentAccepted` is the ONLY consent boolean accepted by the route (line 59 + hard-required at line 119); the server writes exactly ONE consent row `documentKind='personal_data'` at line 263-270. No `offer` or `lessons` consent row is written today on `/register` (round-2 BLOCKER#1 closure: prior plan text "invite-flow keeps current 2-consent set (personal_data + offer/lessons)" was factually wrong — there's only 1 consent set today). New plan adds an OPTIONAL `body.saasOfferConsentAccepted` boolean, captured ONLY when `finalRole === 'teacher' && invitePayload === null`. |
| `app/layout.tsx` `metadata.title` | KEEP-OR-EDIT | text-only "LevelChannel" wordmark stays per owner Q-11a. |
| `public/favicon.svg` | REPLACE | root favicon; current is the "L" mark. Swap to new abstract mark from Sub-B.1. |
| `components/home/teacher-landing-client.tsx:183,186,1200` | REPLACE | three inline `<L>` + `evel<Channel>` wordmark uses; new SaaS landing component re-implements with new mark. |
| `app/offer/page.tsx:37-38` | REPLACE | header wordmark on English-lessons offer; swap to new mark (NOT legal content edit). |
| `docs/design-system.md` | EXTEND | new motion tokens, easing curves, magnetic-cursor primitives, type-scale for Tier-1 hero. |
| `docs/content-style.md` | EXTEND | tone calibration for "1-5 учеников" audience scope. |
| `lib/auth/teacher-learner-mutations.ts` | KEEP (legal review only) | PR #427 lets teacher edit learner email/display_name. NOT touched by this plan, BUT the legal-rf pipeline MUST evaluate whether this surface contradicts the "platform is the only ПД operator" framing. See §3 Q-A.4. |

No surface is silently extended.

## 1. Owner answers (2026-05-30, RU)

Captured for the legal + design pipelines downstream. The legal-rf-router consumes these as `facts_confirmed` (along with the open Qs in §3 as `facts_uncertain`).

| Q | Answer |
|---|---|
| 1. Юрлицо/ИП оферты | Та же ИП Фирсова Анастасия. |
| 2. SaaS tiers | Free (1 ученик, бесплатно), Mid (300₽/мес, 5 учеников), Pro (800₽/мес, 30 учеников), Operator-managed (мы держим деньги учеников, удерживаем %, выплачиваем учителю). |
| 3. 152-ФЗ роль | Owner intent: **мы — оператор ПД учеников**, учитель — НЕ оператор. Это интент для лендинга. Юридическая корректность роли — на legal-rf-router (см. §3 Q-A.4). |
| 4. Money flow | Recurrent на нашем сайте (CloudPayments recurrent). Free/Mid/Pro учители платят НАМ подписку. Operator-managed дополнительно процессит платежи учеников. **Recurrent self-serve flow ещё не реализован** — Epic 4-DEFERRED. |
| 5. Возвраты | Без возврата (Apple-style). Pro-rata НЕ применяется. **Совместимость с ЗоЗПП для цифровых услуг** — на legal-rf. |
| 6. URL оферты | `/saas/offer` (отдельно от `/offer`). |
| 7. Подсудность | Челябинск (как в текущей оферте). |
| 8. Срок/расторжение | Бессрочная с правом одностороннего отказа. 30-дневное уведомление. |
| 9. Дизайн-референсы | Топ-10 awards 2026 (см. §2.2). |
| 10. Скоуп редизайна | Только `/saas` landing. Cabinet/admin не трогаем. |
| 11a. Бренд | Оставляем имя LevelChannel. Тексты — единый стиль. |
| 11b. Логотип | НОВЫЙ, БЕЗ буквы L. Абстрактный mark или wordmark. |
| 12. Анимации | МАКСИМАЛЬНО ЩЕДРО — scroll-driven, magnetic cursor, parallax, micro-interactions. Уровень Bruno Simon / Lando Norris. |
| 13. Целевая аудитория | Маленькие учителя для начала (1-5 учеников). |

## 2. Epic decomposition

### Epic A — SaaS оферта (legal-rf-pipeline)

**Owner of legal content:** `legal-rf-router` (entry point) → routes downstream (likely `legal-rf-commercial`) → `legal-rf-qa` (partner-level red-team). Claude is the orchestrator + UI/DB wrapper. The legal text and clause structure come from the legal-rf stack. Claude does NOT pre-decide:
- Whether "оператор ПД учеников" is the legally clean stance given teacher write surfaces on learner email.
- Whether the no-refund clause survives ЗоЗПП for digital services.
- Whether recurrent autorenew terms are publishable before the technical recurrent flow ships.
- Whether the teacher-platform relationship is a single договор оказания услуг or splits into agency + processor + license.

#### Sub-A.1 — CASE_PACKET for legal-rf-router

Build the brief per `BASE_LEGAL_RF.md §128-147` (16-field CASE_PACKET schema) and invoke `legal-rf-router`. Draft of the packet:

```
1. user_goal:
   Опубликовать SaaS-оферту на /saas/offer для тарифов Free/Mid/Pro/Operator-managed
   с recurrent CloudPayments-подпиской и framing "платформа — оператор ПД учеников".
2. client_type:
   ИП на УСН (исполнитель). Контрагенты: учителя-репетиторы (физлица/самозанятые/ИП).
3. counterparty_or_authority:
   Учителя (B2C-ish). Косвенно: ученики учителей (мы их оператор ПД). Регулятор риска: РКН (152-ФЗ),
   Роспотребнадзор (ЗоЗПП на цифровые услуги), ФНС (НДФЛ/НПД учителей на Operator-managed).
4. domain_guess:
   Commercial offer + платформенная модель + 152-ФЗ.
5. facts_confirmed:
   - ИП Фирсова Анастасия — оператор платформы.
   - 4 тарифа: Free (1 ученик), Mid (300₽/мес, 5 учеников), Pro (800₽/мес, 30 учеников),
     Operator-managed (платежи учеников через нас, удерживаем %, выплачиваем учителю).
   - Recurrent через CloudPayments на нашем сайте.
   - Срок: бессрочно, односторонний отказ с 30-дневным уведомлением.
   - Подсудность: Челябинск.
   - Возвраты: без возврата (intent).
   - Operator intent для 152-ФЗ: WE = оператор учеников, учитель НЕ оператор.
6. facts_uncertain:
   - Конкретный % комиссии на Operator-managed (Q-A.5 — будет уточнён до Sub-A.2).
   - Готов ли учитель быть подписчиком как физлицо без статуса ИП/самозанятого
     (recurrent invoice + чек 54-ФЗ vопрос).
   - Можно ли расценить teacher-edit-learner-email (lib/auth/teacher-learner-mutations.ts)
     как processing-on-behalf и нужно ли отдельное поручение/допсоглашение.
7. documents_available:
   - Текущая English-lessons оферта: app/offer/page.tsx + lib/legal/public-profile.ts (реквизиты ИП).
   - Текущая Privacy Policy: docs/legal/privacy-v1.md (через legal_document_versions).
   - Retention policy: docs/legal/retention-policy.md.
   - Anti-spoof контракт на teacher-write surfaces: lib/auth/teacher-learner-mutations.ts.
   - Money flow реализация: lib/billing/teacher-grant.ts, lib/payments/teacher-derivation.ts.
   - Существующие consent rows: ConsentKind = personal_data | offer | marketing_opt_in | parent_consent.
   - Legal doc versioning: legal_document_versions (mig 0032), doc_kind = offer | privacy | personal_data.
8. deadlines_or_dates:
   Нет жёсткого внешнего дедлайна. Внутренний — launch gate Epic 4-DEFERRED (recurrent flow).
9. amount_or_value_at_stake:
   Прямой риск: РКН проверка по 152-ФЗ (штрафы 300k-1M ₽ за нарушение оператором).
   Косвенный риск: ЗоЗПП-возврат по цифровой услуге (per-customer cost), репутационный.
10. stage_of_matter:
    Пред-draft. Документа ещё нет. Конкурирующий /offer (English lessons) живёт отдельно.
11. jurisdiction_or_region:
    РФ, Челябинская область, российский АПК.
12. risk_tolerance:
    Низкий-средний. Owner хочет публиковать "топовый вариант" (Q-8), готов добавить уведомление за 30 дней.
13. output_needed:
    (1) Полный draft оферты на русском, готовый к публикации.
    (2) Чёткое заключение по 152-ФЗ-роли: можем ли мы быть единственным оператором при наличии teacher
        write surface на learner email; если нет — какое поручение/допсоглашение/согласие требуется.
    (3) Заключение по совместимости no-refund-clause с ЗоЗПП для цифровых услуг.
    (4) Перечень доп. документов которые нужны вокруг оферты (Privacy update? Consent для recurrent?
        Договор поручения с учителем на обработку учеников?).
14. urgent_stop_loss_needed:
    Нет.
15. known_constraints:
    - /saas сейчас noindex и Mid disabled, Pro/Operator = mailto. Оферта НЕ должна публиковаться
      (страница может быть noindex или 404) до того, как Epic 4-DEFERRED откроет self-serve recurrent.
    - Versioning хранится в DB (legal_document_versions.body_md), НЕ git-markdown. Draft → DB row.
    - Существующая English-lessons оферта /offer не трогаем.
    - Подсудность фиксирована (Челябинск).
16. questions_for_agent:
    Q1. Чистый ли intent "мы оператор ПД учеников, учитель не оператор" с учётом того, что учитель может
        редактировать email и display_name своего ученика через UI (lib/auth/teacher-learner-mutations.ts,
        PR #427)? Если нет — какая правильная конструкция (мы оператор + учитель processor on behalf;
        мы оператор + учитель тоже оператор для своей подмножества данных; и т.д.)?
    Q2. Можно ли публиковать оферту с пунктом "автопродление подписки" до того как технически recurrent
        self-serve запущен? Какая формулировка минимизирует риск введения в заблуждение?
    Q3. Совместимость no-refund-clause с ЗоЗПП для цифровых услуг — допустимо ли вообще "как у Apple"?
        Что добавить, чтобы было enforceable?
    Q4. Operator-managed тариф (мы держим деньги учеников и выплачиваем учителю с удержанием %) — это
        агентский договор? платёжный агент по 161-ФЗ? нужна ли отдельная лицензия/регистрация?
    Q5. Какой % комиссии на Operator-managed правильно указать в оферте — фиксированный или диапазон с
        правом изменения по 30-дневному уведомлению?
    Q6. Нужен ли отдельный consent на recurrent autorenew (DB row отдельным doc_kind), или он
        включается в основной consent на SaaS-оферту?
    Q7. Жалоба клиента (учителя) — обязан ли мы соблюдать досудебный порядок до арбитража, и какой срок
        (30 дней по умолчанию или иной)?
```

Router выберет downstream агента + проведёт `legal-rf-qa` round(s) перед SIGN-OFF. Pre-SIGN-OFF этого шага Sub-A.2 не запускается.

#### Sub-A.2 — DB-canonical persistence (and legal-pipeline guard extension)

После legal-rf SIGN-OFF, **в одной PR** (sub-PR.A.2):

1. **Mig 0096** (`migrations/0096_saas_offer_doc_kind.sql`) — (a) extend `legal_document_versions.doc_kind` CHECK constraint to include `saas_offer`; (b) extend `account_consents.document_kind` CHECK constraint to include `saas_offer`; (c) **seed initial v0 placeholder row** (`INSERT INTO legal_document_versions (doc_kind, version_label, effective_from, body_md) VALUES ('saas_offer', 'v0-placeholder-do-not-accept', now(), '## ВНИМАНИЕ\n\nЭто placeholder-запись. Реальная SaaS-оферта будет опубликована администратором после legal-rf SIGN-OFF.') ON CONFLICT DO NOTHING`) so the DB CHECK constraint has a baseline row; the `v0-placeholder-do-not-accept` label is the explicit hard-reject signal (round-3 BLOCKER#2 + round-4 WARN#7 closure). Admin replaces with real v1 via `createLegalVersion('saas_offer', 'v1', <legal-rf SIGN-OFF body>)` post-deploy.
   - **Round-4 WARN#7 closure — consent rollout invariant:** the Sub-A.3 server gate AND the Sub-A.5 cabinet gate BOTH reject any version whose `versionLabel` starts with `v0-placeholder-` (in addition to the existing null-FK rejection). Specifically: `if (currentSaasOfferVersion === null || currentSaasOfferVersion.versionLabel.startsWith('v0-placeholder-')) return 503 / interstitial 'awaiting_publication'`. This means teacher self-reg + cabinet entry HARD-FAIL between mig 0096 deploy and admin's real-v1 publish; no consent row can be written against the placeholder. The placeholder exists ONLY so the DB CHECK constraint is satisfied for the route file's existence; it is NEVER accepted as a consent target. Single concern (`saas_offer` enablement). No other tables touched.
2. **`lib/legal/versions.ts`** (line 13) — extend `LegalDocKind` type: `'offer' | 'privacy' | 'personal_data' | 'saas_offer'`. This is the trigger for compile-mandatory updates downstream.
3. **`lib/auth/consents.ts`** (line 5-9) — extend `ConsentKind` type with `| 'saas_offer'`.
4. **`app/api/admin/legal/versions/route.ts`** — `ALLOWED_KINDS` Set (line 20-24) + GET error string (line 43) + POST error string (line 76).
5. **`app/admin/(gated)/legal/versions-manager.tsx`** — `KINDS` array (line 13-21) gets 4th entry `{ kind: 'saas_offer', label: 'SaaS-оферта', humanPath: '/saas/offer' }`.
6. **`app/admin/(gated)/legal/page.tsx`** — `Promise.all` at line 26-30 gets a 4th `listLegalVersions('saas_offer', 50)` call; the `<LegalVersionsManager initial={...} />` prop at line 52-54 gets a 4th key `saas_offer`. **Compile-mandatory** because of the `Record<LegalDocKind, ...>` shape; if you skip this file, TS breaks at build.
7. **`app/legal/v/[id]/page.tsx`** — `KIND_LABEL` (line 9-13) + `KIND_LIVE_PATH` (line 14-18) both get `saas_offer` entries.
8. **`scripts/legal-pipeline-check.sh`** (round-2 BLOCKER#3 + round-7 WARN#2 + round-8 WARN#2 closure):
   - `LEGAL_PATHS` (line 32-36) appends BOTH `"app/saas/offer/page.tsx"` AND `"app/saas-offer-accept/page.tsx"`.
   - `LEGAL_PREFIXES` (line 39-49) appends THREE entries: `"app/saas/offer/"`, `"app/saas-offer-accept/"`, `"app/api/teacher/saas-offer-accept/"`.
   - Without this, any future edit to the SaaS оферта routes OR the teacher accept interstitial OR the POST handler bypasses the `Legal-Pipeline-Verified:` trailer guard. All three paths are legal-sensitive (the interstitial renders the same `body_md`; the POST handler writes the consent FK).
   - Edit lands in this sub-PR (Sub-A.2-3-5 bundle) BEFORE the new route files are committed so the guard exists immediately when the route file is born.
9. **`docs/legal-pipeline.md`** (round-3 WARN#8 + round-8 WARN#2 closure): the doc's "Protected scope" table at line 18-25 currently lists 3 page files + `lib/legal/**`, `docs/legal/**`, `app/{offer,privacy,consent}/**`. Add THREE rows in the same edit as step 8 above (doc + script stay in sync):
   - `app/saas/offer/page.tsx` — "Public SaaS оферта (DB-canonical render)"
   - `app/saas-offer-accept/page.tsx` — "Existing-teacher SaaS оферта acceptance interstitial"
   - `app/api/teacher/saas-offer-accept/route.ts` — "Server-side consent capture for the interstitial"
   - Also extend the `app/{offer,privacy,consent}/**` glob row note to add `app/saas/offer/**` + `app/saas-offer-accept/**`.
9. **Initial seed (DB-canonical publishing model):**
   - The existing legal versioning is **append-only publish**, not draft/edit. `lib/legal/versions.ts:createLegalVersion` always emits a new row; admin UI at `/admin/legal` has no draft state, no edit, no delete. `getCurrentLegalVersion()` returns the row with greatest `effective_from <= now()`. The admin POST API DOES accept `effectiveFrom` (line 104-128) but the UI doesn't expose the field today.
   - **Therefore: there is no "draft → publish later" path.** Claude/admin publishes v1 directly with `effective_from = now()` via the admin UI immediately after legal-rf SIGN-OFF. From that moment the row is live (`getCurrentLegalVersion('saas_offer')` returns it).
   - This is fine because **the launch gate doesn't depend on the оферта being unreadable** — it depends on (a) `/saas` landing staying `noindex`, (b) Pricing CTAs staying disabled/mailto, (c) no public link from `/`/`/offer`/other learner surfaces. The text of the оферта being readable at `/saas/offer` is consistent with teacher self-reg flow needing to read it to consent.
10. **`/saas/offer` route** = NEW `app/saas/offer/page.tsx` (server component) calls `getCurrentLegalVersion('saas_offer')` and renders `body_md` via the same minimal markdown renderer pattern as `app/legal/v/[id]/page.tsx:BodyRenderer` (lines 109-160). Either import the helper from there (extract to `lib/legal/render-body.tsx`) or duplicate. **Default: extract**, so future legal pages share one renderer. The extract is a Sub-A.2 task, not a separate sub-PR.
11. **Metadata:** `robots: { index: false, follow: false }` until launch gate (§3.5) flips. Page reachable on direct URL (NOT 404 — round-2 BLOCKER#2 closure: 404 would break the teacher consent flow since checkbox links to оферта text). Crawlers excluded via the robots meta. Footer link from `/saas` landing exists; no link from `/`, `/offer`, or other learner-facing surfaces. The consent gate's link to `/saas/offer` therefore lands on a live (noindex) page, not 404.

**No git-markdown source of truth.** The DB row is canonical; admin re-publishes a v2 by inserting a new row (chain semantics enforced by `previous_version_id` + advisory lock per `createLegalVersion` lines 119-172). We do NOT mirror the body to `docs/legal/saas-offer-v1.md`.

#### Sub-A.3 — teacher-only consent gate at `/register`

See §3.6 consent matrix below for the authoritative per-flow contract (round-2 BLOCKER#1 closure). Implementation:

**`app/api/auth/register/route.ts` rule:**

```
// Current code (line 56-64): body shape only has personalDataConsentAccepted.
// Sub-A.3 extends body with optional saasOfferConsentAccepted.
//
// Current code (line 82-101): requestedRole resolution. invitePayload at line 94-101
// forces requestedRole='student' if HMAC verifies.
//
// Gate ORDER (round-5 BLOCKER#3 closure — saas_offer check moves BEFORE
// getAccountByEmail at line 137 so a 503 fires before any account creation
// side-effects at line 157 createAccount + line 168 grantAccountRole):
//
//   STEP 1 (line ~119 — existing): personalDataConsentAccepted required.
//   STEP 2 (NEW, BEFORE existing line 137): if requestedRole === 'teacher' &&
//          invitePayload === null AND SAAS_OFFER_GATE_ENABLED:
//     a) body.saasOfferConsentAccepted must be true → else 400.
//     b) getCurrentLegalVersion('saas_offer') must return non-null AND
//        not a placeholder → else 503 saas_offer_awaiting_publication.
//   STEP 3 (line 137 — existing): getAccountByEmail / createAccount only after
//          STEP 2 passes. Orphan-account-on-503 risk closed.
//
// Code shape:
if (requestedRole === 'teacher' && invitePayload === null && saasOfferGateEnabled) {
  if (body.saasOfferConsentAccepted !== true) {
    return NextResponse.json(
      { error: 'Подтвердите согласие с условиями SaaS-оферты.' },
      { status: 400, headers: NO_STORE },
    )
  }
}
// invite-flow + learner: do NOT inspect body.saasOfferConsentAccepted. Even if
// client lies, server-side requestedRole is 'student' so this branch never runs.

// In the new-email branch (around line 260-270 where the personal_data consent
// is recorded), add a SECOND recordConsent call ONLY when the gate above passed:
if (requestedRole === 'teacher' && invitePayload === null) {
  // saas_offer version check ALREADY happened in STEP 2 above (BEFORE createAccount);
  // by this point we know currentSaasOfferVersion is non-null + non-placeholder.
  // Re-fetch here OR pass through from STEP 2 (latter is preferred — saves a query).
  await recordConsent({
    accountId: account.id,
    documentKind: 'saas_offer',
    documentVersion: currentSaasOfferVersion.versionLabel,
    legalDocumentVersionId: currentSaasOfferVersion.id,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || null,
  })
}
```

**Canonical error code (round-5 WARN#4 closure):** the gate emits `saas_offer_awaiting_publication` (503) for missing/placeholder version. ALL tests assert this exact string. The earlier draft mentioned `saas_offer_version_unavailable` — that name is dropped.

### Sub-A.3 / Sub-A.5 version-TOCTOU contract (round-10 BLOCKER#1 closure)

Concrete race: operator publishes `v2` of `saas_offer` while a teacher has the `v1` form open. Without explicit version pinning, the server either (a) silently writes a `recordConsent` row pointing at `v2` (the teacher's actual consent was to `v1`'s body) or (b) writes a row pointing at `v1` that's already superseded. Both are legally broken.

**Form rendering contract (GET):**
- `/register` (round-11 WARN closure — currently `'use client'` page; needs server/client split): refactor into two files:
  - `app/register/page.tsx` BECOMES a server component that fetches `getCurrentLegalVersion('saas_offer')` server-side and passes `{ saasOfferConsentVersionId, saasOfferConsentVersionLabel }` as props to the client form below.
  - `app/register/register-form-client.tsx` NEW client component that holds the existing form state + receives the two props. The SaaS-оферта checkbox renders a hidden `<input type="hidden" name="saasOfferConsentVersionId" value={props.saasOfferConsentVersionId} />` + label includes the version (e.g. "Я согласен(на) с условиями SaaS-оферты v1").
  - The client form's submit handler reads the hidden value via `FormData` (or controlled state initialised from the prop) and includes it in the POST body. The current `/register/page.tsx` is small (~250 lines per round-3 inventory) so the split is straightforward.
- `/saas-offer-accept`: NEW page is server-component from day one. SSR renders `body_md` of the CURRENT live version AND a hidden field `saasOfferConsentVersionId` carrying its `id` directly. No split needed — interactive logic is just one form submit.

**Submit contract (POST `/api/auth/register` for self-reg + POST `/api/teacher/saas-offer-accept` for interstitial):**

```ts
// Both POST handlers run the same TOCTOU check:
const submittedVersionId = body.saasOfferConsentVersionId  // from hidden form field
const live = await getCurrentLegalVersion('saas_offer')
if (live === null || live.versionLabel.startsWith('v0-placeholder-')) {
  return 503 saas_offer_awaiting_publication
}
if (submittedVersionId !== live.id) {
  // The operator published a new version between GET and POST. The user's
  // consent was to a different body. Reject + ask them to re-read.
  return 409 saas_offer_version_changed (with hint to reload the page)
}
// Safe — consent FK pins to the exact version the user saw.
await recordConsent({
  ..., legalDocumentVersionId: live.id, documentVersion: live.versionLabel,
})
```

**Client UX on 409:** the page detects `saas_offer_version_changed`, shows banner "Оферта обновилась — перечитайте новую версию", auto-reloads the form (GET → SSR re-renders with the new live id). The user's previous click is intentionally discarded; they must explicitly accept the new text.

**Test coverage (round-10 WARN#4 partial closure):**
- Scenario: GET form → operator publishes v2 → POST with v1 versionId → expect **409 `{ error: 'saas_offer_version_changed' }`** + NO consent row written.
- Scenario: GET form → POST same-id (no race) → expect 200 + consent row with FK = the rendered version id.
- Scenario: client tampers with hidden field (sends garbage UUID) → expect 409 (server enforces strict match against live).

### Sub-A.5 backfill contract (round-10 WARN#2 closure)

If legal-rf-router (Q-A.6) approves admin-side backfill as a valid rollout path, it's specified as an explicit SCRIPT, not a one-off SQL paste:

**`scripts/saas-offer-backfill.mjs`** (NEW, runs ONCE post legal-rf SIGN-OFF + admin publish of v1):

- **Target set (round-11 BLOCKER#1 closure — covers bootstrap teachers):** all accounts with active `teacher` role AND `email_verified_at IS NOT NULL` AND no existing active `saas_offer` consent. This includes both self-registered teachers AND bootstrap teachers (`lib/auth/bootstrap-teacher.ts`); the gate is teacher-role + verified, not registration path.
- **`accepted_at` provenance:**
  - Self-registered teachers: latest `auth.teacher.self_registered` audit event timestamp from `auth_audit_events`.
  - Bootstrap teachers (no self-registration event): fall back to `accounts.created_at`.
  - Either way, NOT `now()` — the script claims a retroactive provenance, not a fresh acceptance. The legal-rf SIGN-OFF on Q-A.6 approves or rejects both provenance variants together.
- **`ip` + `user_agent`:** NULL (no claim of a fresh acceptance event; this is a retroactive audit row).
- **`legal_document_version_id`:** FK to the v1 (NOT placeholder) row.
- **`documentVersion`:** `'v1'`.
- **Audit row:** one entry per account in `auth_audit_events` with `eventType='auth.teacher.saas_offer_backfilled'` (NEW event type — requires the auth_audit_events CHECK constraint to accept it; add to mig 0096).
- **Idempotency** (round-11 BLOCKER#1 closure — re-acceptance via `/saas-offer-accept` writes a SECOND active row, so a partial unique index is incompatible). Per-account flow inside the script:
  1. `SELECT id FROM account_consents WHERE account_id = $1 AND document_kind = 'saas_offer' AND revoked_at IS NULL ORDER BY accepted_at DESC LIMIT 1`
  2. If a row exists AND its `legal_document_version_id` matches the current live v1 → skip (already covered).
  3. Otherwise INSERT a new consent row.
  - This is application-level idempotency, NOT a DB constraint. Re-acceptance through `/saas-offer-accept` still allowed to write multiple rows (current = latest non-revoked). The script + the interstitial write through DIFFERENT entry points but share the SAME contract: "current consent = latest non-revoked row matching the current live version".
- **Logging:** dry-run mode first (`--dry-run`), prints the target-set count + sample rows; live mode requires `--confirm`.
- **Rerun safety:** explicitly safe to rerun (the index + idempotent INSERT make it a no-op the second time).

Default rollout = interstitial (Sub-A.5 page-based gate). Backfill is the optional path that requires legal-rf SIGN-OFF on Q-A.6 first.

### Round-10 WARN#3 — PR-prep discovery contract additions

Step 4 of the PR-prep grep block (`find app/teacher ...`) is supplemented by stricter authority-greps:

```bash
# 4a. All "use server" actions reachable from teacher pages
grep -rln "\"use server\"" app/teacher/ components/teacher/

# 4b. All inline role checks in app/teacher/** (catches hand-rolled gates)
grep -rn "listAccountRoles\|roles.includes" app/teacher/

# 4c. All fetch calls to /api/teacher/** from anywhere (server-side or client)
grep -rn "fetch.*'/api/teacher\|fetch.*\"/api/teacher" app/ components/

# 4d. Helper boundary check — every teacher-write helper goes through guard
grep -rn "from '@/lib/auth/guards'" app/api/teacher/ app/api/cabinet/ lib/teacher-telegram-bind/ \
  | grep -v "requireTeacherWithCurrentSaasOfferConsent\|saas-offer-accept"
# ↑ output MUST be empty after the swap; non-empty = a route that still uses
#   the old guard without the consent layer.
```

These four greps replace `find app/teacher` as the authoritative discovery contract. The PR description pastes ALL grep outputs; reviewer cross-checks.

### Round-10 WARN#4 — additional test scenarios

Beyond the 17 in §Sub-A.5 test table, ADD:
- **(18)** GET `/saas-offer-awaiting` with teacher session + `SAAS_OFFER_GATE_ENABLED=1` + live version is placeholder → 200, page renders waiting message.
- **(19)** GET `/saas-offer-awaiting` with teacher session + `SAAS_OFFER_GATE_ENABLED=1` + live version is real v1 + teacher has no consent → 302 redirect to `/saas-offer-accept` (the awaiting page is not the right state).
- **(20)** GET `/saas-offer-awaiting` with teacher session + `SAAS_OFFER_GATE_ENABLED=1` + live version is real v1 + teacher has current consent → 302 redirect to `/teacher` (the awaiting page is not the right state).
- **(21)** GET `/saas-offer-awaiting` with `SAAS_OFFER_GATE_ENABLED=0` → 302 redirect to `/teacher` (gate inactive).
- **(22)** Stale-submit race: GET `/saas-offer-accept` returns v1 id → operator publishes v2 via admin UI → POST `/api/teacher/saas-offer-accept` with v1 id → expect 409 `saas_offer_version_changed`.
- **(23)** Direct POST `/api/teacher/saas-offer-accept` while `SAAS_OFFER_GATE_ENABLED=0` → behavior decision: either reject (404/403) because gate is off and the endpoint shouldn't be reachable, OR accept idempotently. Default plan = ACCEPT (the endpoint is always available; flag only controls whether OTHER routes enforce consent). Test pins the chosen behavior.
- **(24)** Self-reg version-TOCTOU: GET `/register?role=teacher` returns v1 id in hidden field → operator publishes v2 → POST `/api/auth/register` with v1 id → expect 409 `saas_offer_version_changed` + NO `accounts` row inserted.

**`app/register/page.tsx` rule (round-3 BLOCKER#1 + round-4 BLOCKER#2 closure — full consent-copy rewrite):**

The existing checkbox at `app/register/page.tsx:200-214` is shared between all flows and says "Я согласен(на) с офертой [→ /offer], политикой..., согласие на их обработку". This text is wrong for ALL flows after this wave:
- For learner self-reg: "офертой" link points to the English-lessons (Анастасия) оферта. Misleading; the consent row written server-side is only `personal_data`, not `offer`. Either capture an `offer` consent (out of scope of this wave) OR remove the "офертой" reference and link.
- For teacher self-reg: needs its OWN SaaS-оферта checkbox (linked to `/saas/offer`), AND the existing "офертой" reference must not double-claim consent to the English-lessons оферта.
- For invite-flow: same as learner — the existing "офертой" reference is incorrect.

Concrete rewrite (round-3 BLOCKER#1 + round-4 BLOCKER#2):

1. **Drop the "с офертой" phrase + link** from the existing checkbox label. The checkbox now reads: "Я согласен(на) с политикой обработки персональных данных и даю согласие на их обработку." This matches what the server actually persists (`document_kind='personal_data'` only).
2. **Add a SECOND checkbox, conditionally rendered** when `role === 'teacher' && inviteToken === null`. Round-4 BLOCKER#2 closure: the condition reads the LIVE `role` state (line 33 `useState`), NOT the `initialRole` constant. Otherwise a user landing on plain `/register` and then toggling the radio to "Я учитель" via lines 168-174 never sees the SaaS checkbox. The render condition watches `role`; the form button + the submitted body both follow the same `role` reactive value.
3. Label text: "Я согласен(на) с условиями SaaS-оферты LevelChannel" with link to `/saas/offer` (target="_blank"). State boolean `saasOfferAgreed`. Posted as `saasOfferConsentAccepted: saasOfferAgreed` ONLY when the conditional is satisfied.
4. When user toggles `role` radio BACK to `'student'`, the SaaS checkbox unmounts and `saasOfferAgreed` is dropped from the body (controlled by the same conditional).
5. The "Создать аккаунт" button stays disabled until ALL currently-rendered checkboxes are checked (1 in learner/invite flows, 2 in teacher self-reg).

Why this is required (not optional): the round-3 BLOCKER#1 critique was that ASKING for "офертой" consent in the UI while only PERSISTING `personal_data` server-side is a legal-evidence-trail discrepancy. Either persist the consent claim or stop claiming it. Sub-A.3 fixes the discrepancy by dropping the unfounded claim from the UI.

**Anti-spoof:** server is the authoritative gate (mirrors the existing invite anti-spoof at line 95-101). Even if the client posts `saasOfferConsentAccepted: true` along with a valid `inviteToken`, the server-side `invitePayload !== null` forces `requestedRole='student'` first, then the consent capture branch never fires.

**Test pinning (round-3 BLOCKER#4 closure — correct response codes):**

Existing register contract is anti-enumeration: **`200 { ok: true }` body-equal for both new-email and existing-email branches** (verified `app/api/auth/register/route.ts:46,297`). Test expectations:

- **New integration test:** `tests/integration/auth/register-saas-consent.test.ts` (inside `tests/integration/**/*.test.ts` glob per `vitest.integration.config.ts:17`). Covers:
  - (a) `role=teacher`, no invite, `saasOfferConsentAccepted=true` → **200 `{ ok: true }`** + `account_consents` row with `document_kind='saas_offer'` + `legal_document_version_id = <FK to current saas_offer row>` written.
  - (b) `role=teacher`, no invite, `saasOfferConsentAccepted` missing/false → **400** with the new error message (NOT 200; this is the only branch that diverges from anti-enumeration since it's a client-input validation, same as the existing personal_data-not-accepted branch at line 119-124).
  - (c) `role=student`, no invite, `saasOfferConsentAccepted=true` (client tries to spoof) → **200 `{ ok: true }`** + NO `saas_offer` consent row.
  - (d) `role=teacher`, valid invite token, `saasOfferConsentAccepted=true` (client tries to spoof) → **200 `{ ok: true }`** with `requestedRole='student'` + NO `saas_offer` consent row + learner bound to inviting teacher.
  - (e) **mig 0096 placeholder missing simulation:** truncate `legal_document_versions` where `doc_kind='saas_offer'`, then attempt teacher self-reg → **503 `{ error: 'saas_offer_awaiting_publication' }`** (round-3 BLOCKER#2 closure verification). MUST also assert: NO row inserted into `accounts` for the email used (round-5 BLOCKER#3 — orphan-account check; the 503 fires BEFORE createAccount, so the account is never created).
  - (f) **Placeholder-only state simulation:** seed `legal_document_versions` with ONLY the `v0-placeholder-do-not-accept` row (no real v1), then attempt teacher self-reg → **503 `{ error: 'saas_offer_awaiting_publication' }`** + NO `accounts` row inserted.
  - (g) **Gate-OFF behavior:** with `SAAS_OFFER_GATE_ENABLED=false`, teacher self-reg succeeds without saasOfferConsentAccepted → **200 `{ ok: true }`** + no `saas_offer` consent row written (current behavior preserved when flag OFF).
- **Existing integration test extension:** `tests/integration/auth/register.test.ts` — verify the existing 200/ok-true assertions still pass with the new optional body field (default behaviour for learner flow unchanged).
- **Existing legal versions test extension:** `tests/integration/legal/versions.test.ts:18` (round-2 WARN#5) — extend `kind` fixtures to cover `saas_offer` round-trip.
- **Integration fixture extension** (round-3 WARN#7 + round-8 INFO#4 + round-9 INFO#4 closure): `tests/integration/setup.ts:67-81` currently re-seeds 3 doc kinds. After Sub-A.2 mig 0096, the migration seeds ONLY `v0-placeholder-do-not-accept`. The fixture adds a DELIBERATE post-publication baseline `saas_offer v1` row (NOT mirroring the migration — simulating the post-admin-publish state). Test scenarios that need the placeholder-only path (e.g. round-5 BLOCKER#3 test (e) + (f)) explicitly DELETE the `v1` row first. Without the v1 baseline, every integration test exercising teacher self-reg or `getCurrentLegalVersion('saas_offer')` fails for fixture reasons.

#### Sub-A.5 — existing-teacher re-consent gate (round-3 BLOCKER#3 closure)

SAAS-PIVOT Day 2 (PR #413, 2026-05-22) shipped `/register?role=teacher` self-reg. Teachers may already exist in prod (or staging) WITHOUT a `saas_offer` consent row. Publishing the оферта + Sub-A.3 gates only NEW teacher registration; existing teachers operate without the consent on file. That's a regulatory gap and a fairness gap (new teachers commit; existing don't).

**Gate design (round-4 BLOCKER#3 + BLOCKER#4 + round-5 BLOCKER#2 closure):**

**Round-5 BLOCKER#2 closure — single shared predicate for SSR + all teacher APIs.** SSR-only layout gate is insufficient because `/api/teacher/**` mutations (e.g., `/api/teacher/tariffs/route.ts:50`, `/api/teacher/invites/route.ts:40`, `/api/teacher/packages/route.ts:37`) use plain `requireTeacherAndVerified` and can keep mutating state even when the cabinet is gated. Concrete shape:

**Round-8 BLOCKER#1 closure — SSR/Request interface split.** The SSR `app/teacher/layout.tsx` already resolves the session via `cookies()` + `lookupSession(cookieValue)` (line 38-50). The Request-side API guard pipeline calls `getCurrentSession(request)` which itself just wraps `lookupSession` (`lib/auth/sessions.ts:178-183`). So the contract must be CORE = session/account-keyed, not Request-keyed. Two thin wrappers + 1 core helper:

```ts
// lib/auth/guards.ts — round-5 BLOCKER#2 + round-8 BLOCKER#1:

// CORE: takes an already-resolved Session (covers both SSR + Request callers).
// Returns 'ok' | 'awaiting' | 'consent_required' verdict; the caller maps
// it to either redirect (SSR) or JSON-response (API).
export type SaasOfferGateVerdict =
  | { kind: 'ok' }
  | { kind: 'awaiting_publication' }
  | { kind: 'consent_required' }

export async function evaluateSaasOfferGate(
  accountId: string,
): Promise<SaasOfferGateVerdict> {
  if (!saasOfferGateEnabled) return { kind: 'ok' }
  const live = await getCurrentLegalVersion('saas_offer')
  if (live === null || live.versionLabel.startsWith('v0-placeholder-')) {
    return { kind: 'awaiting_publication' }
  }
  const consent = await getActiveConsent(accountId, 'saas_offer')
  if (consent === null || consent.legalDocumentVersionId !== live.id) {
    return { kind: 'consent_required' }
  }
  return { kind: 'ok' }
}

// REQUEST WRAPPER for /api/teacher/** routes:
export async function requireTeacherWithCurrentSaasOfferConsent(
  request: Request,
): Promise<TeacherGuardOk | TeacherGuardFail> {
  const inner = await requireTeacherAndVerified(request)
  if (!inner.ok) return inner
  const verdict = await evaluateSaasOfferGate(inner.account.id)
  if (verdict.kind === 'ok') return inner
  const code = verdict.kind === 'awaiting_publication'
    ? { error: 'saas_offer_awaiting_publication', status: 503 }
    : { error: 'saas_offer_consent_required', status: 403 }
  return { ok: false, response: NextResponse.json(
    { error: code.error }, { status: code.status, headers: NO_STORE },
  ) }
}

// SSR usage in app/teacher/layout.tsx (after the existing lookupSession +
// role check around line 44-58):
//   const verdict = await evaluateSaasOfferGate(current.account.id)
//   if (verdict.kind === 'awaiting_publication') redirect('/saas-offer-awaiting')
//   if (verdict.kind === 'consent_required') redirect('/saas-offer-accept')
// The redirect targets are pages outside /teacher/** so no layout loop.
//
// SSR usage in app/saas-offer-accept/page.tsx (own layout, mirrors the same
// session lookup + verdict; only allows 'consent_required' state to reach
// the page; 'ok' redirects to /teacher; 'awaiting_publication' redirects to
// /saas-offer-awaiting).
```

Same core (`evaluateSaasOfferGate`) is reused by SSR + every API; no logic duplication.

**ALL teacher API routes that mutate state** MUST go through the new predicate in this PR. Round-6 BLOCKER#1 closure: a pure grep on `requireTeacherAndVerified` misses routes that do their own inline role check (notably the Google OAuth callback). Full enumeration:

**PR-prep discovery contract (round-10 holistic sweep).** Instead of pinning a static list that drifts every time someone adds a teacher route, the bundle PR author runs the following grep at PR-prep time and applies the swap to EVERY hit, with EXPLICIT exception list documented in the PR description:

```bash
# 1. All API routes using guards or inline role checks
grep -rln "requireTeacherAndVerified\|listAccountRoles\|requireAdminRole" \
  app/api/teacher/ app/api/admin/ app/api/cabinet/

# 2. All lib helpers that do inline teacher role checks (server actions etc.)
grep -rln "roles.includes.*teacher\|requireTeacher" lib/ \
  | grep -v "\.test\."

# 3. All Telegram webhook teacher-branch consume paths
grep -n "teacher_telegram_bind\|TeacherTelegramBind" \
  app/api/telegram/webhook/route.ts lib/teacher-telegram-bind/

# 4. All teacher-cabinet SSR pages (must inherit layout-level gate; no opt-out)
find app/teacher -type f \( -name "*.tsx" -o -name "*.ts" \)
```

**Documented exceptions (do NOT get the gate):**
- `app/api/teacher/saas-offer-accept/route.ts` — gating the consent capture itself would infinite-loop.
- `app/teacher/layout.tsx` — IS the gate (calls `evaluateSaasOfferGate` directly).
- Admin routes (`app/api/admin/**`) — out of scope (operator can edit teacher data on the teacher's behalf; admin path doesn't need saas_offer consent).
- Cabinet routes (`app/api/cabinet/**`, `app/cabinet/**`) — learner-side; doesn't touch the SaaS оферта.
- Read-only routes — included by default (gate-OFF behavior preserves them) but reviewer may exempt specific GET handlers if the gate would surprise the user. Default: include.

**Static inventory snapshot (2026-05-30) for reference only** — the PR-prep grep is the authority, not this list:

| Surface | Files (snapshot) |
|---|---|
| `/api/teacher/**` via `requireTeacherAndVerified` | 24 routes (tariffs, tariffs/[id], invites, invites/[id]/revoke, packages, packages/[id], packages/[id]/issue, packages/[id]/revoke, lessons/[id]/uncomplete, slots, slots/bulk-create, slots/[id]/move, slots/[id]/cancel, slots/[id]/conflicts, slots/[id]/dismiss-conflict, slots/[id]/delete-external-conflict, slots/[id]/zoom-url, calendar/google/start, calendar/google/disconnect, calendar/orphan-slots, calendar/orphan-slots/ignore, hidden-slots, learners/[id]/rename, learners/[id]/settle) |
| `/api/teacher/calendar/google/callback/route.ts:117-119` | INLINE role check (NOT through guard); MUST get the gate inlined alongside |
| `lib/teacher-telegram-bind/actions.ts:62,117` | Server actions — inline role check; MUST get the gate alongside |
| `lib/scheduling/slots/mutations-write.ts` | Inline teacher-context check; gated callers must propagate the gate verdict |
| `app/api/telegram/webhook/route.ts:154,205` | Teacher-branch consume path; teacher_account_id known from bind row → `evaluateSaasOfferGate(teacherAccountId)` callable without session |
| Server actions inside `app/teacher/**/*.tsx` (e.g. `learners/[id]/rename-form.tsx`, `learners/[id]/settle/page.tsx`, `learners/[id]/uncomplete-button.tsx`) | Inherit layout-level gate AS LONG AS the action's POST handler also calls the gate (defense in depth) |

The PR-prep grep output MUST be pasted into the PR description; reviewer cross-checks it covers every hit minus the documented exceptions. Any new file added since 2026-05-30 surfaces here automatically.

**Full inventory (snapshot) from `grep -rln` on 2026-05-30 below for reviewer convenience.** Authority is the grep run at PR-prep time, NOT this list:

ALL routes below swap their teacher-auth check to `requireTeacherWithCurrentSaasOfferConsent`. Some routes today use `requireTeacherAndVerified` directly; some do inline `listAccountRoles` checks; the bundle PR unifies all of them on the new predicate.

Inventory (full set found by grep):

| # | Route | Today's auth |
|---|---|---|
| 1 | `app/api/teacher/tariffs/route.ts` | `requireTeacherAndVerified` |
| 2 | `app/api/teacher/tariffs/[id]/route.ts` | `requireTeacherAndVerified` |
| 3 | `app/api/teacher/invites/route.ts` | `requireTeacherAndVerified` |
| 4 | `app/api/teacher/invites/[id]/revoke/route.ts` | `requireTeacherAndVerified` |
| 5 | `app/api/teacher/packages/route.ts` | `requireTeacherAndVerified` |
| 6 | `app/api/teacher/packages/[id]/route.ts` | `requireTeacherAndVerified` |
| 7 | `app/api/teacher/packages/[id]/issue/route.ts` | `requireTeacherAndVerified` |
| 8 | `app/api/teacher/packages/[id]/revoke/route.ts` | `requireTeacherAndVerified` |
| 9 | `app/api/teacher/lessons/[id]/uncomplete/route.ts` | `requireTeacherAndVerified` (NOTE: `app/api/teacher/lessons/[id]/mark/route.ts` does NOT exist — the canonical mark path lives at `app/api/admin/slots/[id]/mark/route.ts`; teacher-side marking goes through `lib/scheduling/slots/lifecycle.ts:markSlotLifecycle` from a different route surface). |
| 10 | `app/api/teacher/slots/route.ts` | `requireTeacherAndVerified` |
| 11 | `app/api/teacher/slots/bulk-create/route.ts` | `requireTeacherAndVerified` |
| 12 | `app/api/teacher/slots/[id]/move/route.ts` | `requireTeacherAndVerified` |
| 13 | `app/api/teacher/slots/[id]/cancel/route.ts` | `requireTeacherAndVerified` |
| 14 | `app/api/teacher/slots/[id]/conflicts/route.ts` | `requireTeacherAndVerified` |
| 15 | `app/api/teacher/slots/[id]/dismiss-conflict/route.ts` | `requireTeacherAndVerified` |
| 16 | `app/api/teacher/slots/[id]/delete-external-conflict/route.ts` | `requireTeacherAndVerified` |
| 17 | `app/api/teacher/slots/[id]/zoom-url/route.ts` | `requireTeacherAndVerified` |
| 18 | `app/api/teacher/calendar/google/start/route.ts` | `requireTeacherAndVerified` (NOT `/connect/`) |
| 19 | `app/api/teacher/calendar/google/disconnect/route.ts` | `requireTeacherAndVerified` |
| 20 | `app/api/teacher/calendar/orphan-slots/route.ts` | `requireTeacherAndVerified` |
| 21 | `app/api/teacher/calendar/orphan-slots/ignore/route.ts` | `requireTeacherAndVerified` |
| 22 | `app/api/teacher/hidden-slots/route.ts` | `requireTeacherAndVerified` |
| 23 | `app/api/teacher/learners/[id]/rename/route.ts` | `requireTeacherAndVerified` (lib/auth/teacher-learner-mutations.ts caller) |
| 24 | `app/api/teacher/learners/[id]/settle/route.ts` | `requireTeacherAndVerified` |
| 25 | `app/api/teacher/calendar/google/callback/route.ts` | **INLINE** `listAccountRoles` + `roles.includes('admin') \|\| !roles.includes('teacher')` at line 117-119. Explicit comment at line 115-116 says "We don't reuse requireTeacherAndVerified() here because it…" (the OAuth callback doesn't enter through the standard `Request → guard` pipeline). Sub-A.2-3-5 ADDS the saas_offer consent check inline AFTER the existing role check, BEFORE `upsertGoogleIntegration` at line 146. Concrete shape: `if (saasOfferGateEnabled) { const live = await getCurrentLegalVersion('saas_offer'); ... if not consented → redirectToSettings(origin, { error: 'saas_offer_consent_required' }) }`. |

**Exception (does NOT use the gate):**
- `app/api/teacher/saas-offer-accept/route.ts` (NEW) — uses plain `requireTeacherAndVerified` because the user is heading TO consent capture; gating on consent would infinite-loop.

**Test updates required (round-6 BLOCKER#1 + round-7 BLOCKER#1):**
- `tests/integration/calendar/google-routes.test.ts:79-181` — extend the existing teacher-OAuth tests to assert: (a) with gate ON + no consent → callback redirects with `error=saas_offer_consent_required` instead of `wrong_role`; (b) with gate ON + valid consent → callback proceeds; (c) with gate OFF → existing behaviour preserved; (d) start route inherits the same gating.
- For each of the 24 swapped routes (rows 1-24 + 25 inline), add at minimum ONE assertion to its existing test (or in a new shared fixture) that the gate triggers 403 `saas_offer_consent_required` with gate ON + no consent. Default approach: ONE consolidated test file `tests/integration/saas-offer-gate/teacher-api-blanket.test.ts` that parametrises across the 24 routes (route, method, dummy-body) and asserts the gate on all of them. Avoids 24 individual file edits.

**Grep verification step (PR-prep):** `grep -rln "requireTeacherAndVerified\|listAccountRoles" app/api/teacher/` MUST return EXACTLY these 25 files. If grep reveals a 26th file (a new route added by an in-flight branch), Sub-A.2-3-5 expands to include it before merge.

- **SSR surface:** `app/teacher/layout.tsx` (line 33-58 currently handles auth + role redirects; the new check joins the same chain BEFORE rendering children) calls `requireTeacherWithCurrentSaasOfferConsent` (same predicate as the APIs). On `saas_offer_consent_required`, it redirects to `/saas-offer-accept` instead of returning the 403 JSON. Predicate: does the session account have an ACTIVE (`revoked_at IS NULL`) `saas_offer` consent row whose `legal_document_version_id` matches `getCurrentLegalVersion('saas_offer').id`?
- **If yes:** pass through (render `<SiteHeader />` + `<TeacherCabinetNav>` + children).
- **If no:** redirect to `/saas-offer-accept` (TOP-LEVEL route, NOT under `/teacher/**`). Round-4 BLOCKER#3 closure: previous plan said `/teacher/accept-saas-offer` which would re-enter the same `app/teacher/layout.tsx` and infinite-loop the gate. The accept page lives at `app/saas-offer-accept/page.tsx` as a NEW top-level route with its own minimal layout (no `<SiteHeader />` teacher chrome — just the оферта body + checkbox + submit button).
- The accept page calls its OWN auth check (mirror `requireTeacherAndVerified` from `lib/auth/guards.ts:164` at SSR layer): only an authenticated session with `teacher` role + verified email reaches it. Anonymous → `/login`. Admin → `/admin/slots`. Learner → `/cabinet`. Teacher-with-current-consent (rare race case) → `/teacher`.
- On submit (POST `/api/teacher/saas-offer-accept`), handler **uses `requireTeacherAndVerified` from `lib/auth/guards.ts:164`** (round-4 BLOCKER#4 closure — previous plan said "admin session with teacher role" which is wrong; a regular teacher is NOT admin and the requirement would be unreachable). Handler writes a new `recordConsent({ documentKind: 'saas_offer', documentVersion, legalDocumentVersionId })` row. Re-acceptance idempotent at the application layer (multiple rows allowed; CURRENT consent = latest non-revoked row matching the CURRENT live version).
- **Teacher cannot reach** any other `/teacher/**` route until they accept (the layout-level redirect happens before any child renders).
- **Backfill option** (alternative to interstitial): admin-side data migration writes `saas_offer` consent rows for ALL existing teacher accounts. **Legal-rf must approve this** (Q-A.6 below). Default: pick the interstitial unless legal-rf says backfill is OK.

**Decision required from legal-rf-router (added as Q-A.6 in the Sub-A.1 CASE_PACKET):** for already-registered teachers (pre-publication), is it legally valid to auto-deem acceptance of the new SaaS оферта via admin-side backfill INSERT, citing the original `auth.teacher.self_registered` audit event timestamp as the "implicit acceptance moment"? Or MUST we force re-acceptance via the interstitial? Default plan = interstitial; backfill only if legal-rf SIGN-OFFs it.

**Sub-A.5 ships IN THE SAME PR as Sub-A.2 + Sub-A.3** per §4 Day 2 atomic rollout — round-5 BLOCKER#1 closure. The whole gate is shipped behind `SAAS_OFFER_GATE_ENABLED` flag; sequencing is operator-controlled, not deploy-controlled.

**Test coverage for Sub-A.5 (round-5 WARN#5 closure):**

NEW integration test file `tests/integration/auth/saas-offer-gate.test.ts`:

| # | Scenario | Expected |
|---|---|---|
| 1 | Teacher session, no `saas_offer` consent, GET `/teacher` (layout) | 302 redirect to `/saas-offer-accept` |
| 2 | Teacher session WITH current consent, GET `/teacher` | 200 cabinet rendered |
| 3 | Teacher session, outdated consent (FK to previous version), GET `/teacher` | 302 redirect to `/saas-offer-accept` (re-consent required) |
| 4 | Teacher session, no consent, POST `/api/teacher/tariffs` | 403 `{ error: 'saas_offer_consent_required' }` |
| 5 | Teacher session, no consent, POST `/api/teacher/invites` | 403 `{ error: 'saas_offer_consent_required' }` |
| 6 | Teacher session, no consent, POST `/api/teacher/packages` | 403 `{ error: 'saas_offer_consent_required' }` |
| 7 | Teacher session, GET `/saas-offer-accept` (exception path) | 200 page rendered with current `body_md` |
| 8 | Anonymous session, GET `/saas-offer-accept` | 302 redirect to `/login` |
| 9 | Learner session, GET `/saas-offer-accept` | 302 redirect to `/cabinet` (no teacher role) |
| 10 | Admin session, GET `/saas-offer-accept` | 302 redirect to `/admin/slots` |
| 11 | Teacher session, POST `/api/teacher/saas-offer-accept` (first acceptance) | 200 `{ ok: true }` + `account_consents` row written with current FK |
| 12 | Teacher session, POST `/api/teacher/saas-offer-accept` (re-acceptance of same version, idempotent) | 200 `{ ok: true }` + SECOND `account_consents` row written (multi-row allowed; current = latest non-revoked) |
| 13 | Teacher session, POST `/api/teacher/saas-offer-accept` with placeholder version live | 503 `saas_offer_awaiting_publication` |
| 14 | Anonymous POST `/api/teacher/saas-offer-accept` | 401 |
| 15 | Learner POST `/api/teacher/saas-offer-accept` | 403 `wrong_role` (mirror existing pattern) |
| 16 | Gate flag OFF + teacher session no consent, GET `/teacher` | 200 cabinet rendered (gate inactive) |
| 17 | Gate flag OFF + teacher session no consent, POST `/api/teacher/tariffs` | normal route behavior (gate inactive) |

Existing integration tests for `/api/teacher/**` endpoints (e.g. `tests/integration/scheduling/teacher-slots-auth.test.ts`, `tests/integration/saas-pivot/teacher-rename-learner.test.ts`) MUST be re-verified: those tests set up teacher sessions; they need a baseline `saas_offer` consent row in the fixture so the gate doesn't 403 them. The integration setup fixture (`tests/integration/setup.ts` re-seed) adds a helper `seedTeacherWithSaasOfferConsent(accountId)` used by every existing teacher-auth test. Without this, every existing teacher-API test breaks for fixture-not-product reasons.

#### Sub-A.4 — paranoia + ship

- Single-PR Sub-A.2-3-5 bundle (round-5 BLOCKER#1 atomic rollout + round-6 BLOCKER#2 critical-path elevation): **`Codex-Paranoia: SIGN-OFF round N/3`** (NOT `SUB-WAVE self-reviewed`). Reason: the bundle EXTENDS `lib/admin/operator-settings.ts` which is item #21 on the 29-file critical-path inventory (`docs/critical-path.md:54`). Per the critical-path rule, ANY PR touching that file MUST land with a full `/codex-paranoia wave` SIGN-OFF round, not a sub-wave self-review. Wave runs on the bundle's commit range before merge.
- Epic-end (after Epic A AND Epic B's sub-PRs all land) runs `/codex-paranoia wave <range>` for epic-close.

### Epic B — Tier-1 landing redesign

Decomposed into 5 sub-PRs. Each runs Claude self-review; epic-end paranoia wave covers the aggregated diff.

#### Sub-B.1 — design tokens + new logo + performance prototype

- **`docs/design-system.md`** extended with: motion library (easing curves: `ease-out-expo`, `ease-out-back`, `spring-soft`; durations: `fast=180ms / base=240ms / slow=420ms / theatrical=720ms`; stagger patterns), magnetic-cursor primitives (radius, snap easing, max-displacement), dual-axis scroll-trigger primitives, hero type-scale (`96px desktop / 64px tablet / 48px mobile`), micro-interaction primitives.
- **Tokens scoped under `.saas-chrome`** (per SAAS-1-5A precedent) — new design MUST NOT bleed into cabinet/admin/`/offer`/`/`.
- **New logo:** 4 options, abstract mark, NO letter L. Options to evaluate: (a) dot+wordmark, (b) circle-pulse mark, (c) infinity-loop ribbon, (d) chevron/arrow forward-motion mark. Owner picks ONE via screenshot review.
- **Logo asset enumerated touchpoints** (round-3 BLOCKER#5 + round-4 BLOCKER#5 closure — full re-grep across `components/**` and `app/**` 2026-05-30).

  **Scope decision (Q-B.5 — owner choice):** the new logo applies to which surfaces?
  - **Option A (default):** new logo applies to ALL "LevelChannel" branded surfaces — single brand-mark across the ИП.
  - **Option B:** new logo applies to SaaS chrome + shared transactional surfaces (header, payment pages, admin); Анастасия English-lessons landing surface (`/` + `/offer`) keeps current `L` wordmark. Favicon picks SaaS mark.

  Owner picks during Sub-B.1 logo-options review.

  **Full visual touchpoint inventory (round-4 BLOCKER#5 — previously missed enumerations now included):**

  | # | File:line | Mark type | Option A | Option B |
  |---|---|---|---|---|
  | 1 | `public/favicon.svg` | Root favicon SVG | SWAP | SWAP (to SaaS mark) |
  | 2 | `components/home/teacher-landing-client.tsx:183,186,1200` | SaaS landing header + footer wordmark | SWAP | SWAP |
  | 3 | `components/home/home-page-client.tsx:158,918` | Анастасия landing header + footer wordmark | SWAP | KEEP (Option B preserves Анастасия brand) |
  | 4 | `app/offer/page.tsx:37-38` | English-lessons оферта header wordmark | SWAP | OWNER DECISION (shared ИП entity but English-brand context — defer to Sub-B.1) |
  | 5 | `components/site-header.tsx:86` | Shared site header wordmark "LevelChannel" | SWAP | SWAP (header is reused on transactional pages) |
  | 6 | `app/pay/page.tsx:81` | `/pay` header wordmark "LevelChannel" | SWAP | SWAP (transactional surface — shared across both products) |
  | 7 | `app/checkout/[tariffSlug]/page.tsx:116` | Checkout header wordmark | SWAP | SWAP (transactional) |
  | 8 | `app/t/[slug]/pay/page.tsx:119` | Teacher-pay-page wordmark | SWAP | SWAP |
  | 9 | `app/layout.tsx:13,19` | Text-only `metadata.title` "LevelChannel — ..." | KEEP (no visual change, owner Q-11a keeps the name) | KEEP |
  | 10 | `app/saas/page.tsx:14,26` | Text-only metadata title | KEEP | KEEP |

  Partial swap = brand-fragmentation incident. Sub-B.1 PR ships the swap atomically for whichever scope (A or B) the owner picked AND the matching set of files from the table above.

  **Grep verification 2026-05-30:** `grep -rn "Level\|>L<\|wordmark" app/ components/` — every match cross-checked against the table above. Confirmed: no additional visual brand instances missed.
- **Performance prototype (early gate):** before locking on the motion library + WebGL hero approach, build a 1-component Sub-B.1-internal prototype that proves Lighthouse Performance ≥85 on mobile slow-4G with the chosen animation stack. If the prototype falls below 85, scope back BEFORE Sub-B.3 starts (cheaper than Sub-B.5 backpedal).
- **Skill invocations** (per `~/.claude/SKILLS.md §external-design-a11y` — real slash-commands installed 2026-05-20):
  - `/design-with-claude:design-system-architect` — token extension review.
  - `/design-with-claude:brand-designer` — 4 logo options + selection guidance.
  - `/design-with-claude:motion-designer` — easing + duration calibration.
  - `/design-with-claude:performance-specialist` — performance prototype red-team.

#### Sub-B.2 — copywriting unification for `/saas` landing

- `docs/content-style.md` extended with: tone for "1-5 учеников" audience, value-prop hierarchy, prohibited terms list, glossary.
- Hero + benefit + pricing + FAQ copy rewritten through the new style guide.
- **Selling-point claims:** every claim that touches legal status (152-ФЗ-роль; учитель как processor; "мы оператор") MUST be cross-checked against the legal-rf SIGN-OFF of Sub-A.1 before going into the landing. If legal-rf concludes the framing isn't clean as Q-A.4 worried, the landing copy adjusts (no marketing claim that contradicts the оферта).
- **Skill invocations:**
  - `/design-with-claude:content-strategist` — copy rewrite owner.
  - `/design-with-claude:landing-page-specialist` — pricing card framing + CTA placement.
  - `/design-with-claude:b2b-saas-specialist` — value-prop hierarchy for B2B tone.

#### Sub-B.3 — landing rebuild (HTML/CSS/JS)

- REPLACE `components/home/teacher-landing-client.tsx` with `components/saas/saas-landing-tier1.tsx`. Decompose into:
  - `<Hero>` — full-viewport, large-canvas/WebGL background, magnetic-cursor logo reveal, scroll-cued headline.
  - `<HowItWorks>` — 3-step horizontal scroll-triggered cards.
  - `<Features>` — 6-card grid with 3D tilt + spotlight cursor on hover.
  - `<Pricing>` — 4 tier cards (Free / Mid / Pro / Operator-managed). Until Epic 4-DEFERRED ships, Mid/Pro/Operator CTA = mailto OR disabled (matches current `tests/saas-pivot/landing.test.tsx:75-90` contract — DO NOT regress to enabling self-serve checkout before recurrent flow exists).
  - `<SocialProof>` — research-based positioning (no fake testimonials).
  - `<FAQ>` — accordion with smooth open/close motion.
  - `<Footer>` — link to `/saas/offer` (live but `noindex`; see §3.5 — NOT 404, round-2 BLOCKER#2 closure), `/privacy`, `/consent/personal-data` (round-2 WARN#7 closure: `/consent` route does NOT exist — only `/consent/personal-data`), support email.
- Animation library: default Framer Motion (React-native + RSC-friendly); GSAP only if motion-designer specialist says Framer can't hit the brief.
- WebGL: hero may use Three.js if Sub-B.1 performance prototype validated it. Otherwise vanilla CSS/SVG hero.
- **Skill invocations:**
  - `/design-with-claude:interaction-designer` — micro-interaction catalogue.
  - `/design-with-claude:visual-hierarchy-specialist` — section composition.
  - `/design-with-claude:typography-specialist` — type-scale finalisation.
  - `/design-with-claude:responsive-design-specialist` — mobile-first pass.

#### Sub-B.4 — accessibility pass

- WCAG 2.1 Level AA preserved despite generous animations.
- `prefers-reduced-motion` respected: ALL scroll-triggered + magnetic-cursor + WebGL animations disabled when set; static fallback renders the same content.
- Skip-to-content link preserved (SAAS-6-A11Y-1 PR #370 precedent).
- Color contrast: every text element ≥4.5:1 against background even when overlaying parallax/video.
- Keyboard navigation: every interactive element focusable + visible focus ring.
- **Skill invocations:**
  - `web-accessibility-wizard` — full WCAG audit of the rebuilt landing.
  - `/design-with-claude:accessibility-specialist` — pair on the audit.

#### Sub-B.5 — performance + Core Web Vitals

- LCP target ≤2.5s on slow 4G.
- Hero asset code-split + preloaded.
- Lighthouse Performance ≥90 (Sub-B.1 prototype proved feasibility; Sub-B.5 is the verify gate).
- Lighthouse Accessibility ≥95, Best Practices ≥95, SEO ≥95.
- **Skill invocations:** `/design-with-claude:performance-specialist` final verify.

## 2.2 Top-10 design references (research 2026-05-30)

| # | Reference | Use case |
|---|---|---|
| 1 | Lando Norris (Awwwards SOTY 2026) | Hero WebGL benchmark, scroll-driven storytelling |
| 2 | Storylane | SaaS clarity + demo-flow lift — pricing/CTA placement |
| 3 | Zenda | Awwwards-nominated SaaS rebrand — tone calibration |
| 4 | Beeble.ai | AI SaaS + clarity — feature card grid |
| 5 | Figma | Pricing tier comparison + "free forever" framing |
| 6 | Bruno Simon (Site of Month Jan 2026) | Generous Three.js animation budget reference |
| 7 | Linear | Restraint + typography baseline — what NOT to over-do |
| 8 | Vercel | Dark mode typography density + dev tooling tone |
| 9 | Cal.com | Booking SaaS — direct competitor, learn pricing transparency |
| 10 | Stripe Docs | Clarity + illustration discipline |

Each sub-PR's design reviewer cross-checks against this list.

## 3. Edge cases / open Qs

- **Q-A.1 — version DB extension** — settled in §0z: mig 0096 extends doc_kind CHECK + seeds initial `saas_offer` `v0-placeholder-do-not-accept` row (round-3 BLOCKER#2 + round-9 INFO#4 closure — NOT "v1 placeholder"; the canonical contract uses v0-prefixed label to be explicit about rejection); single concern; no other tables touched.
- **Q-A.2 — recurrent subscription flow not yet shipped** — settled in §3.5 launch gate. Оферта persisted в DB + admin-доступна; страница `/saas/offer` **live but noindex** (round-3 WARN#6 closure: NOT 404 — teacher consent gate links to it). Никакая публичная транзакция self-serve не появляется до тех пор пока Epic 4-DEFERRED не активирует recurrent flow.
- **Q-A.3 — initial seed** — Claude вызывает `createLegalVersion` через admin UI после legal-rf SIGN-OFF, не SQL-seed в миграции.
- **Q-A.4 — teacher write surface on learner email/name** — `lib/auth/teacher-learner-mutations.ts` (PR #427) lets a teacher edit a linked learner's email/display_name. Это юридически значимо для "platform=единственный оператор ПД" framing. Question routed to legal-rf-router as `questions_for_agent Q1` в Sub-A.1 CASE_PACKET. Если legal-rf заключит что framing неконсистентен — Sub-B.2 копи не использует "152-ФЗ снимаем с учителя" как selling-point. Landing claims следуют legal-rf-выводу, не маркетингу.
- **Q-A.5 — % комиссии Operator-managed** — routed to legal-rf-router as `questions_for_agent Q5`. Fixed vs range. Решение приходит из Sub-A.1.
- **Q-B.1 — new logo selection by owner** — Sub-B.1 produces 4 logo options + screenshots; owner picks ONE before Sub-B.3 wires it in. Single-PR swap of all enumerated touchpoints (§Sub-B.1).
- **Q-B.2 — Three.js / WebGL budget** — Sub-B.1 prototype is the early gate (NOT Sub-B.5 cleanup). If prototype < Lighthouse 85, scope back before Sub-B.3.
- **Q-B.3 — analytics on landing** — track CTA clicks, pricing tier hovers, FAQ opens. NEW or extends existing `lib/telemetry` — confirm during Sub-B.3.
- **Q-B.4 — owner sign-off cadence** — each sub-PR opens screenshot/video preview for owner before merge.

### 3.5 Launch gate — landing non-transactional + non-indexed until Epic 4-DEFERRED

Round-2 BLOCKER#2 closure clarification: the existing legal versioning architecture is **append-only publish** (no draft state). "Draft → DB row" wording from round-1 closure was imprecise. Concrete contract:

Until the recurrent CloudPayments self-serve flow (Epic 4-DEFERRED) ships:

1. **`/saas` landing** stays `metadata.robots = { index: false, follow: false }` (current state per `app/saas/page.tsx:17-23`). Tier-1 redesign DOES NOT flip this flag.
2. **`/saas` Pricing cards** keep Mid disabled and Pro/Operator-managed at `mailto:` only. Self-serve "Купить" CTAs DO NOT activate. See round-2 WARN#6 closure: existing `tests/saas-pivot/landing.test.tsx` pins MORE than just CTAs — full rewrite scope listed in §3.7.
3. **`/saas/offer` page** is LIVE in DB (v1 published immediately after legal-rf SIGN-OFF via admin UI) AND reachable by direct URL, BUT carries `metadata.robots = { index: false, follow: false }`. It's NOT 404 — teacher consent gate links to it, and 404 would break the consent flow. Page itself does not "leak" because:
   - It's noindex (crawlers excluded).
   - The only public link to it is from `/saas` footer; `/saas` itself is noindex.
   - It is NEVER linked from `/`, `/offer`, `/privacy`, or other learner-facing surfaces.
4. **Sub-A.3 consent gate** is wired (server captures `saas_offer` consent on teacher self-reg). Teacher distribution at this stage = owner-issued links to `/register?role=teacher`; no public discovery path.
5. **Launch flip (single follow-up PR after Epic 4-DEFERRED):** removes `robots.index=false` from `/saas` (and `/saas/offer` if owner chooses public search-indexability for the оферта), activates self-serve "Купить" CTAs in Pricing cards, adds optional public footer link from `/` if desired. PR carries its own paranoia trailer + `Legal-Pipeline-Verified:` if `app/saas/offer/page.tsx` is touched.

This is the explicit answer to round-1 BLOCKER#4 ("no launch gate") and the round-2 BLOCKER#2 publication-contradiction reconcile: the оферта is live in DB and the page renders the live row; the GATE is the landing non-transactional state + noindex, not the оферта being inaccessible.

### 3.6 Consent matrix — what /register captures per flow (round-2 BLOCKER#1 closure)

Currently (verified 2026-05-30 vs `app/api/auth/register/route.ts`):

| Branch | role resolution | Consents captured (today) | Notes |
|---|---|---|---|
| Learner self-reg (no `?role=teacher`, no invite) | `requestedRole='student'` | `personal_data` only (line 263-270) | No `offer`/`lessons` row written despite the consent UI checkbox being framed as "оферта". The actual /register form's text just captures personal data consent. |
| Teacher self-reg (`?role=teacher`, no invite) | `requestedRole='teacher'` (line 82-83) | `personal_data` only | Today no SaaS-оферта consent exists. |
| Invite-flow (token present, role forced) | `requestedRole='student'` (line 95-101) | `personal_data` only | Server discards any `body.role`. |

After Sub-A.3 ships (target state):

| Branch | role resolution | Consents captured (target) | Notes |
|---|---|---|---|
| Learner self-reg | `requestedRole='student'` | `personal_data` only | Unchanged. |
| Teacher self-reg | `requestedRole='teacher'` | `personal_data` + `saas_offer` | NEW second `recordConsent` call with `documentKind='saas_offer'` + FK to `getCurrentLegalVersion('saas_offer')`. Both consents written in the same new-account block; no transactional atomicity beyond what the existing register flow provides (see `teacher_cabinet_polish` memory note re: non-tx + best-effort consent capture). |
| Invite-flow | `requestedRole='student'` | `personal_data` only | Unchanged. Even if `body.saasOfferConsentAccepted=true` is posted, the gate condition `requestedRole === 'teacher' && invitePayload === null` is false → no second consent row. |

Anti-spoof: the matrix is enforced server-side by the SAME conditional in both the gate-check and the `recordConsent` invocation, ensuring they cannot diverge. Client UI mirroring is best-effort — the server is authoritative.

### 3.7 Landing test rewrite scope (round-2 WARN#6 closure)

Tier-1 redesign breaks more than CTA semantics in `tests/saas-pivot/landing.test.tsx`. Plan acknowledges and budgets:

| Test pin | Current assertion | Expected change |
|---|---|---|
| Line 17 | hero copy (specific h1/h2 text) | REWRITTEN — Sub-B.2 owns new hero copy via content-strategist; test re-pinned. |
| Line 48 | `/pay` footer fallback link present | KEEP — `/pay` is the learner payment flow on the English-lessons side; landing footer may still reference it for invited learners. Sub-B.3 verifies and re-pins. |
| Line 68 | comparison block "Чем мы отличаемся" structure | LIKELY REWRITTEN — Tier-1 layout supersedes; if section is preserved, copy will change. Sub-B.3 owns. |
| Line 75 | Mid card disabled state | KEEP — launch gate (§3.5) preserves this. Test stays green by design. |
| Line 83 | Pro card mailto CTA | KEEP — launch gate preserves. |
| Line 90 | Operator-managed card mailto CTA | KEEP — launch gate preserves. |
| Line 125 | heading hierarchy (h1, h2 order) | LIKELY CHANGED — new sections introduce new headings. Sub-B.4 (a11y) re-asserts heading order; Sub-B.3 updates the pin. |
| Line 154 | teacher-only hint text presence | DEPENDS on hint surviving Tier-1 rewrite. If kept → re-pin updated text; if removed → remove the assertion. |

Sub-B.3 task: each pinned assertion has an explicit "update test" or "remove test" decision before merge. No assertion is silently weakened.

## 4. Day-by-day sequence

**Day 0 (today).** Plan-paranoia rounds 1-N on this doc. SIGN-OFF gate.

**Day 1 — Sub-A.1 (CASE_PACKET → legal-rf-router) + Sub-B.1 (tokens + 4 logo options + performance prototype) in parallel.**
- Sub-A.1: build CASE_PACKET per §2.A.1, invoke `legal-rf-router`. Wait for downstream agent + `legal-rf-qa` SIGN-OFF.
- Sub-B.1: token extension + 4 logo screenshots + performance prototype. Owner picks logo + Q-B.5 scope (A/B). Prototype validates Lighthouse ≥85 budget.

**Day 2 — Sub-A.2 + Sub-A.3 + Sub-A.5 SINGLE-PR FEATURE-FLAGGED ATOMIC ROLLOUT (round-5 BLOCKER#1 closure) + Sub-B.2 (copy rewrite).**

Round-4 BLOCKER#1 + round-5 BLOCKER#1: the three-PR rollout I sketched earlier still leaves a window. Same day ≠ zero window. Replaced with SINGLE-PR feature flag:

- **ONE Sub-A.2-3-5 PR** ships:
  - Mig 0096 (placeholder seed).
  - `LegalDocKind` + `ConsentKind` extensions + admin UI + `/saas/offer` route + `scripts/legal-pipeline-check.sh` + `docs/legal-pipeline.md`.
  - Server consent gate code in `/register` route (`Sub-A.3`).
  - UI checkbox rewrite in `/register` page (`Sub-A.3`).
  - `app/saas-offer-accept/page.tsx` + `app/api/teacher/saas-offer-accept/route.ts` (`Sub-A.5`).
  - NEW shared guard `requireTeacherWithCurrentSaasOfferConsent` in `lib/auth/guards.ts` (round-5 BLOCKER#2 closure — details in Sub-A.5).
  - Operator-settings extension (round-6 WARN#3 + round-8 WARN#3 closure — flat key, int 0/1 because the current `SETTING_SCHEMA` `kind` enum only supports `'int' | 'decimal'`, no `'boolean'` — verified `lib/admin/operator-settings.ts:54,65,80`):
    - **`lib/admin/operator-settings.ts SETTING_SCHEMA`** — NEW entry `SAAS_OFFER_GATE_ENABLED` (uppercase, flat-key style same as existing keys). Shape: `{ kind: 'int', min: 0, max: 1, defaultValue: 0, ... }`. Value `1` = gate ON; `0` = gate OFF. (NOT a nested `saas_offer.gate_enabled` because the existing schema isn't scoped that way — see `app/admin/(gated)/settings/alerts/setting-editor.tsx:15` which only accepts `int | decimal` kinds.)
    - **`scripts/lib/operator-settings.mjs SETTING_SCHEMA`** — IDENTICAL mirror entry (the TS↔MJS drift test `tests/admin/operator-settings.test.ts:18-30,69-99` pins `JSON.stringify` equality; without mirror update the test reds CI).
    - **`tests/admin/operator-settings.test.ts`** — add `SAAS_OFFER_GATE_ENABLED` to the drift-test fixture coverage.
    - **Predicate helper** `saasOfferGateEnabled` (`lib/auth/guards.ts` or `lib/admin/operator-settings-read.ts`) reads the int and returns `value === 1`. ALL gate-aware code (server consent gate, SSR layout, `requireTeacherWithCurrentSaasOfferConsent`, `/saas-offer-accept` page) uses this helper, never reads the raw int.
    - **Admin UI exposure** — `app/admin/(gated)/layout.tsx:90` currently links to `/admin/settings/alerts` and `/admin/settings/digest`. Bundle adds a third nav entry `/admin/settings/saas-offer` pointing at NEW page `app/admin/(gated)/settings/saas-offer/page.tsx`. Page renders ONE toggle UI for `SAAS_OFFER_GATE_ENABLED` (0/1 → label "Выкл/Вкл"); reuses the existing `setting-editor.tsx` shape from `app/admin/(gated)/settings/alerts/setting-editor.tsx:15` (which already handles `int` kind, just constrained to 0/1). Discoverability is explicit — operator does NOT need to know an env var name; the page is one click from `/admin`.
  - **ALL of the gate behaviour above is conditional on `SAAS_OFFER_GATE_ENABLED === 1`** (round-9 WARN#3 closure — flat key per round-8 schema decision, NOT nested `saas_offer.gate_enabled`) via the DB→env→default chain. Default int = `0` (= OFF). With flag OFF, behavior matches current prod: teacher self-reg writes only `personal_data` consent, teacher cabinet renders without the interstitial, teacher APIs use plain `requireTeacherAndVerified`.

- **Deploy sequence (now truly atomic — zero-window):**
  1. PR merges + autodeploy lands. Flag still OFF; behavior unchanged.
  2. Operator (Claude or owner) publishes the legal-rf-signed v1 row via admin UI (`createLegalVersion('saas_offer', 'v1', <body>)`). Placeholder `v0-placeholder-do-not-accept` becomes the `previous_version_id`; v1 is now live.
  3. Operator runs the backfill SCRIPT (`node scripts/saas-offer-backfill.mjs --confirm`) OR queues the interstitial path per Q-A.6 legal-rf decision. Backfill script behavior specified in §Sub-A.5 backfill contract — NOT ad-hoc SQL. If interstitial-only path: skip this step.
  4. Operator flips `SAAS_OFFER_GATE_ENABLED` from `0` to `1` via the NEW `/admin/settings/saas-offer` page (round-9 WARN#3 closure — flat int key per `SETTING_SCHEMA` contract). Instant — no deploy needed because `operator_settings` is hot-read via `lib/admin/operator-settings.ts`.
  5. From this moment: teacher self-reg requires the saas_offer checkbox; teacher cabinet + APIs require active saas_offer consent; existing teachers without backfill see the interstitial.

- **Rollback:** if anything goes wrong, operator flips the flag back to `false`. Code stays deployed; behavior reverts. No DB rollback needed (consent rows already written stay; just stop enforcing new ones).

- Sub-B.2: copy rewrite via content-strategist + landing-page-specialist; claims cross-checked against Sub-A.1 SIGN-OFF.

**Day 3-4 — Sub-B.3 (landing rebuild).** Largest sub-PR; 2 days. Pricing CTAs stay disabled/mailto per §3.5.

**Day 5 — Sub-B.4 (a11y) + Sub-B.5 (perf verify) in parallel.**
- Sub-B.4: WCAG audit.
- Sub-B.5: Lighthouse verify (perf prototype debt closed earlier).

**Day 6 — Epic-end paranoia wave + owner sign-off + ship.** Launch gate stays closed (§3.5).

## 5. Risks

1. **Legal-rf rounds fail to SIGN-OFF.** Drafted оферта или 152-ФЗ-конструкция имеет BLOCKERs которые нуждаются в owner-уточнении. Mitigation: §2.A.1 CASE_PACKET ловит все 7 known open Qs; legal-rf эскалирует owner только при genuine ambiguity.
2. **Legal-rf заключает что "we are only operator" не работает с teacher write surface.** Тогда Sub-B.2 копи отказывается от "152-ФЗ снимаем с учителя" selling-point + legal-rf предлагает doc-of-processing/допсоглашение/иной framing. Sub-A.2 включает дополнительный doc_kind для этого допсоглашения если требуется.
3. **Performance budget vs animation generosity.** Sub-B.1 prototype — early gate. Если < 85 — scope-back до Sub-B.3.
4. **Logo replacement orphans existing brand assets.** Mitigation: §Sub-B.1 enumerated touchpoints — все 4 файла-touchpoint мигрируют в одном sub-PR.
5. **Recurrent subscription flow not built.** §3.5 launch gate prevents premature publication.
6. **Single-PR Sub-B.3 size.** Mitigation: 3 commits (Hero+Layout / Features+Pricing / FAQ+Footer+Polish) в одном PR для atomic review.

## 6. Trailer expectations

Each commit body carries the trailers required by ALL applicable repository guardrails:

| Sub-PR | `Codex-Paranoia:` trailer | `Legal-Pipeline-Verified:` trailer required? |
|---|---|---|
| Sub-A.1 (CASE_PACKET + legal-rf invocation) | NOT a code commit. No trailer. | N/A. |
| Sub-A.2-3-5 single-PR bundle (mig 0096 + `lib/legal/**` + `app/saas/offer/**` + `scripts/legal-pipeline-check.sh` extension + admin UI + register consent gate + `/saas-offer-accept` interstitial + shared `requireTeacherWithCurrentSaasOfferConsent` guard + `lib/admin/operator-settings.ts` flag) | **`Codex-Paranoia: SIGN-OFF round N/3`** (round-6 BLOCKER#2 — critical-path crossing on `lib/admin/operator-settings.ts` requires full `/codex-paranoia wave` round, NOT sub-wave self-review). | **YES.** Touches `lib/legal/versions.ts` + creates `app/saas/offer/page.tsx` + `/saas-offer-accept` + `/api/teacher/saas-offer-accept`. Trailer value: `Legal-Pipeline-Verified: legal-rf-router → legal-rf-<sub> → legal-rf-qa (YYYY-MM-DD)` referencing the Sub-A.1 SIGN-OFF artefact. Round-2 WARN#8 + round-5 INFO#6 closure (one consistent name: "Sub-A.2-3-5 bundle"). |
| Sub-B.1 (tokens + logo) | same SUB-WAVE trailer | **CONDITIONAL** (round-7 WARN#3 closure): IF the owner picked Option A (single brand) → YES, because Sub-B.1 swaps the wordmark in `app/offer/page.tsx:37-38` (legal-pipeline scope) → trailer value `Legal-Pipeline-Verified: trivial-fix — wordmark asset swap, no legal text change`. IF the owner picked Option B (SaaS-only) AND `app/offer/page.tsx` is NOT touched → NO. The PR author checks the actual file list and applies the trailer only when the protected path is touched. Round-2 WARN#8 + round-7 WARN#3 closure. |
| Sub-B.2 through Sub-B.5 | same SUB-WAVE trailer | NO unless an unexpected legal-path edit lands. Default no; reviewer adds if scope drifts. |
| Epic-close PR (after all sub-PRs land) | `/codex-paranoia wave <range>` → `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` | YES if epic-close commit itself touches legal scope; otherwise NO. |

**Critical-path crossings** (per `docs/critical-path.md` 29-file inventory, re-verified 2026-05-30 + round-6 BLOCKER#2):
- **`lib/admin/operator-settings.ts` IS on the 29-file list (item #21, `docs/critical-path.md:54`).** Sub-A.2-3-5 bundle adds the `SAAS_OFFER_GATE_ENABLED` key to `SETTING_SCHEMA` → **bundle MUST land with full `Codex-Paranoia: SIGN-OFF round N/3` trailer, NOT `SUB-WAVE self-reviewed`** (round-6 BLOCKER#2 closure).
- `app/api/auth/register/route.ts` is NOT in the 29-file list. Bundle touches it but does NOT require its own wave run beyond the bundle wave; bundle wave covers it.
- `lib/auth/guards.ts` is NOT in the 29-file list (the list includes `lib/auth/sessions.ts` + `lib/auth/learner-archetype.ts` + `lib/auth/teacher-invites.ts` but not `guards.ts`). However: adding `requireTeacherWithCurrentSaasOfferConsent` to `guards.ts` is a security-gate change. Even though not formally critical-path, the bundle wave round covers it.
- `lib/auth/consents.ts`, `lib/legal/versions.ts`, `app/legal/v/[id]/page.tsx`, `app/admin/(gated)/legal/versions-manager.tsx`, `app/api/admin/legal/versions/route.ts` are NOT in the 29-file list.
- None of the Epic B surfaces are on the 29-file list.
- Therefore: bundle PR runs full `/codex-paranoia wave` round (NOT sub-wave) before merge. Epic-end wave run on aggregated diff stays the standard close-out.

## 7. Skill invocations expected

Per `~/.claude/SKILLS.md` (verified 2026-05-30; design skills under `~/.claude/commands/design-with-claude/` after the 2026-05-20 external-skills install):

**Legal pipeline (Epic A):**
- `legal-rf-router` (Sub-A.1) — entry point. Routes downstream + invokes `legal-rf-qa`.

**Design pipeline (Epic B) — all `/design-with-claude:<specialist>` real slash-commands:**
- Sub-B.1: `design-system-architect`, `brand-designer`, `motion-designer`, `performance-specialist`.
- Sub-B.2: `content-strategist`, `landing-page-specialist`, `b2b-saas-specialist`.
- Sub-B.3: `interaction-designer`, `visual-hierarchy-specialist`, `typography-specialist`, `responsive-design-specialist`.
- Sub-B.4: `web-accessibility-wizard` + `/design-with-claude:accessibility-specialist`.
- Sub-B.5: `/design-with-claude:performance-specialist` final verify.

**Adversarial review:**
- `/codex-paranoia plan` (THIS plan-doc, rounds 1-3).
- `/codex-paranoia wave` (epic-end).

If a skill name above does NOT exist under `~/.claude/commands/design-with-claude/` или `~/.claude/skills/legal-rf-*/`, orchestrator surfaces the gap before the sub-PR opens.

---

— END OF ROUND-7-CLOSURE DRAFT, plan-paranoia round 8 pending —

---

## 8. Update 2026-05-30 — Operator-managed tier deferred + ФНС API removed (post-Sub-A.1 v1)

Two material owner decisions captured mid-session, AFTER plan-paranoia SIGN-OFF (round 11) AND after Sub-A.1 v1 draft was produced:

1. **"Давай пока уберем в дальний беклог часть про прием платежей за учителей. Его надо продумать отдельно."** — Operator-managed tier is DEFERRED to a future epic with its own plan doc. At launch, tariffs are **Free / Mid / Pro only** (LevelChannel subscription, no money flow between learner and teacher through the platform).

2. **"Зачем нам ФНС апи?"** — ФНС API integration is REMOVED entirely. With Operator-managed out of scope, the platform does NOT process learner→teacher payments, so it cannot be a tax agent under 422-ФЗ, so the НПД-status verification API is not needed. Teachers retain their own tax responsibility under their own contract with learners (off-platform).

### Scope deltas

| Area | Before update | After update |
|---|---|---|
| Epic A — оферта tier coverage | Free / Mid / Pro / Operator-managed | Free / Mid / Pro only |
| Sub-A.1 deliverable (legal-rf draft) | v1 with §3.4 Operator-managed (agency contract ГК 1005, НПД-only requirement, 10% commission, чек 54-ФЗ) | **v2 needed** — drop §3.4 entirely + references to Operator-managed throughout §2.1, §2.2, §5.1.1, §5.1.5, §5.2.2, §5.3.2, §5.3.4. Re-run `legal-rf-qa` on v2. |
| Sub-A.2-3-5 bundle code | Unchanged | Unchanged. Schema/gate/migration code does NOT depend on tier count. |
| Sub-A.5 backfill (Q-A.6) | Unchanged | Unchanged. |
| Sub-B.3 landing Pricing section | 4 tier cards (Free / Mid / Pro / Operator-managed) | 3 tier cards (Free / Mid / Pro) |
| `tests/saas-pivot/landing.test.tsx` pricing pins | 4 cards asserted | 3 cards asserted — remove the Operator-managed assertion |
| ФНС API integration | Mentioned in legal §3.4.5 + §3.4.7 (НПД chek automation) | DROPPED entirely |
| Brand mark (Q-B.5) | TBD between Option A (single brand) vs Option B (SaaS-only) | **Option A — единый бренд везде. Final mark = Option O v6 (ascending sine wave + two endpoint dots), see Sub-B.1 close-out PR.** |

### What this means for downstream sub-PRs

- **Sub-A.1 v2:** legal-rf-router → legal-rf-commercial → legal-rf-qa second pass. v2 file `docs/legal/saas-drafts/saas-offer-draft-v2-operator-deferred.md` REPLACES v1 as the source of truth for admin publication.
- **Sub-A.2-3-5 bundle:** no code change vs original plan. The gate/migration/consent code is tier-count-agnostic.
- **Sub-B.3 landing Pricing:** 3 cards instead of 4. CTA states preserved per §3.5 launch gate (Mid disabled, Pro mailto). Operator-managed card removed.
- **Sub-B.2 copy:** value-prop hierarchy excludes Operator-managed framing. No mention of "мы держим деньги учеников".
- **Critical-path inventory:** unchanged. `lib/admin/operator-settings.ts` still in scope for the bundle PR (SAAS_OFFER_GATE_ENABLED flag).

### Paranoia treatment

Plan-doc body above remains valid as the implementation contract for Epic A code and Epic B structure. This Update §8 is a **scope-cut**, not a new design — Operator-managed was already isolated as a separate tier in §3.4 and §2.B. Removal does NOT invalidate the SIGN-OFF for the rest of the plan.

For Sub-A.1 v2 regeneration, the legal-rf chain runs anew on the reduced scope; that does not require plan-paranoia re-run. The Sub-A.2-3-5 bundle still runs full `/codex-paranoia wave` per §6 (critical-path crossing on `lib/admin/operator-settings.ts`).

Captured in auto-memory: `saas_offer_landing_wave_status.md` + `levelchannel_brand_mark_option_o.md`.

---

## §0ab — Round-8 findings (recorded 2026-06-04, BLOCK; closures deferred)

Codex paranoia round 8 returned BLOCK with 6 BLOCKERs + 1 WARN. Raw output: `/tmp/codex-paranoia-20260604T060004Z-saas-offer/round-8.md`. **Findings recorded for audit but closures deferred to next session** — substantive plan revisions across §0z migration contract, blast-radius modelling, TOCTOU pinning, telegram-bind action gating, evals contract sync, and `evaluateSaasOfferGate()` snapshot semantics. Estimated 200-400 lines of plan revision.

| # | Severity | Summary | Closure approach |
|---|---|---|---|
| 1 | BLOCKER | Plan still references "next mig 0096" / shipped-mig contract drift — migrations 0096 + 0097 + 0099 are already in main, so the plan's migration-order/rollback contract is false. (plan:43,178-179,773-774; `migrations/0096_saas_offer_doc_kind.sql`, `migrations/0097_saas_processor_terms_doc_kind.sql`, `migrations/0099_saas_v1_publish_and_flip.sql`) | Rewrite §0z migration block + §2.B rollout section to acknowledge that the three migrations shipped (foundation Sub-A.1 status: DONE) — plan now scopes only Sub-A.2-3-5 bundle + Sub-B. |
| 2 | BLOCKER | Plan models blast radius as single-doc `saas_offer`, but live SoT is two-document: `saas_processor_terms` shipped alongside via mig 0097 and has its own routes/admin UI/self-reg flow. A literal follow-through of this plan would prompt someone to "clean up" `saas_processor_terms` and break the live bundle. (plan:37-45,174-201,205-257,874-876; `lib/legal/versions.ts:13-18`; `app/admin/(gated)/legal/page.tsx:26-33,55-62`; `app/admin/(gated)/legal/versions-manager.tsx:13-26`; `app/saas/processor-terms/page.tsx`; `app/register/page.tsx:305-323`; `app/api/auth/register/route.ts:129-186`) | Rewrite §0z + §1 + §2 to model the bundle as two coupled documents: `saas_offer` (the agreement) + `saas_processor_terms` (the processor terms). Every blast-radius enum extension applies to both. |
| 3 | BLOCKER | TOCTOU race still open on `saas_processor_terms`: plan pins/compares only `saasOfferConsentVersionId` GET-vs-POST; the processor-terms version can flip between GET (when learner sees terms) and POST (when consent recorded), silently writing a `combinedVersion` the learner never saw. (plan:262-299; `app/register/page.tsx:37-45,61-67,100-104,305-323`; `app/api/auth/register/route.ts:163-186,349-359`; `app/saas/processor-terms/page.tsx:60-62`) | Extend the TOCTOU contract from §0z + Sub-A.3 to pin BOTH `saasOfferConsentVersionId` AND `saasProcessorTermsConsentVersionId` GET→POST; both must match the live versions at write time, else 409 `version_changed`. |
| 4 | BLOCKER | Plan gates BOTH `bind` AND `unbind` in `lib/teacher-telegram-bind/actions.ts`; unbind must remain an escape hatch (a teacher without current consent must still be able to stop Telegram delivery). (plan:33; `lib/teacher-telegram-bind/actions.ts:50-111,118-205`) | Limit gate to `bind` call-site only; document explicitly in plan that `unbind` is an opt-out path that cannot be blocked by consent state. |
| 5 | BLOCKER | New top-level routes (`/saas-offer-accept`, `/saas-offer-awaiting`, `/admin/settings/saas-offer`) absent from `evals/PRODUCT_FLOWS.md` and `evals/URL_REDIRECT_CONTRACT.md`. Contract files are mandatory for this project (see `docs/plans/CRITICAL-PATH-INVENTORY.md`). (plan:30-32,449-456,784,791; `evals/PRODUCT_FLOWS.md:71-83`; `evals/URL_REDIRECT_CONTRACT.md:20-31,87-99`) | Add explicit Sub-A.2 file list entries for both evals files + diff scope. |
| 6 | BLOCKER | `evaluateSaasOfferGate()` is two independent reads (`getCurrentLegalVersion` + `getActiveConsent`) without TX/snapshot. Plan elevates it to the mutating-`/api/teacher/**` perimeter; under publish-v2 race a single mutation can still slip through with stale consent. (plan:415-443,461-543; `lib/auth/guards.ts:360-396`) | Refactor `evaluateSaasOfferGate()` to take a single TX-bound snapshot: `SELECT current_version_id FROM legal_versions WHERE kind='saas_offer' AND is_active LIMIT 1` joined with `SELECT consent_version_id FROM consents WHERE...` in one query, with `FOR SHARE` if the read needs to outlast the read txn. Plan must specify the SQL contract + a regression test. |
| 7 | WARN | Audit trail for interstitial accept underspecified — plan expands `AUTH_AUDIT_EVENT_TYPES` to include `auth.teacher.saas_offer_accepted` but accept handler writes only `recordConsent()`. Schema promises a stronger audit trail than the code provides. (plan:314-315,549; `lib/audit/auth-events.ts:27-37`; `app/api/teacher/saas-offer-accept/route.ts:91-101`) | Add explicit `recordAuthAuditEvent({eventType:'auth.teacher.saas_offer_accepted', accountId: teacher.id, payload: { consentVersionId, ip, ua }})` call in accept handler; document in plan §Sub-A.3. |

**Round-9 prep work (deferred):** rewrite §0z migration contract (mig 0096/0097/0099 already shipped), §1 + §2 blast-radius to two-document bundle, Sub-A.3 TOCTOU contract for both docs, telegram-bind gate scope, evals contract sync, `evaluateSaasOfferGate()` TX snapshot semantics, audit emit. Estimated 200-400 plan-doc lines + decisions on TX snapshot SQL shape that may require additional codex consult.

---

## §0ac — Round-8 closures (2026-06-04, supersede contradictions in §0z / §2 / §6)

This section is the authoritative closure for the round-8 findings recorded in §0ab. Where this section contradicts older inline text (especially in §0z file-list and §6 Sub-A.4 risk list), §0ac wins.

### Closure #1 (BLOCKER#1 — migration contract stale)

**Fact:** migrations `0096_saas_offer_doc_kind.sql`, `0097_saas_processor_terms_doc_kind.sql`, and `0099_saas_v1_publish_and_flip.sql` are already in main as of 2026-06-04 (verify: `ls migrations/ | grep saas`). Foundation Sub-A.1 (CASE_PACKET + legal-rf v1 drafting + DB schema enable) has SHIPPED.

**Closure:** the §0z row "`migrations/0096_saas_offer_doc_kind.sql` | NEW" is now historical (shipped). The remaining scope this plan covers is:
- Sub-A.2 — DB-canonical persistence wrappers + legal-pipeline guard extension (partially shipped — see `scripts/legal-pipeline-check.sh` LEGAL_PREFIXES; verify final extension before Sub-A.2 PR).
- Sub-A.3 + Sub-A.5 — `/register` consent gate + existing-teacher re-consent gate + interstitial routes (`/saas-offer-accept`, `/saas-offer-awaiting`).
- Sub-A.4 — paranoia + ship.
- Epic B — landing redesign.

The "next mig slot" claim in §0z is wrong; next free slot is `0104` (after the duplicate-0103 sweep tracked separately). No new migration is required by Sub-A.2 / A.3 / A.5; the CHECK constraints are already widened by 0096 / 0097.

### Closure #2 (BLOCKER#2 — two-document bundle)

**Fact:** the live legal bundle is TWO documents: `saas_offer` (the SaaS agreement, mig 0096) AND `saas_processor_terms` (the operator-of-ПД processing terms, mig 0097). Both are referenced by `lib/legal/versions.ts:13-18`, the admin legal UI, public routes, and the self-reg flow.

**Closure:** all blast-radius bullets in §0z that name `saas_offer` ALSO apply to `saas_processor_terms`. Specifically:
- `lib/auth/consents.ts ConsentKind`: includes both `saas_offer` AND `saas_processor_terms` (verify in current main; if only one is listed, the gap is an additional BLOCKER to close before Sub-A.3 ships).
- `lib/legal/versions.ts LegalDocKind`: same — both kinds.
- Admin legal UI (`versions-manager.tsx`, `page.tsx`) must list BOTH tabs.
- `scripts/legal-pipeline-check.sh` `LEGAL_PATHS` / `LEGAL_PREFIXES`: must protect BOTH document routes (`app/saas/offer/` AND `app/saas/processor-terms/`) plus both accept handlers if separate.

`saas_processor_terms` is NOT to be removed; the plan must protect both. Any future "cleanup" PR that drops the second kind is a regression.

### Closure #3 (BLOCKER#3 — TOCTOU on saas_processor_terms)

**Fact:** the round-2 BLOCKER#1 + round-10 BLOCKER#1 closure pinned `saasOfferConsentVersionId` GET→POST equality (see §Sub-A.3 / Sub-A.5 version-TOCTOU contract). It did NOT pin `saasProcessorTermsConsentVersionId`. Two-document bundle implies both pins are required.

**Closure:** the §3.6 consent matrix and §Sub-A.3 version-TOCTOU contract are amended to require BOTH `saasOfferConsentVersionId` AND `saasProcessorTermsConsentVersionId` in the POST body for teacher-register-without-invite. The server compares both to the live `getCurrentLegalVersion('saas_offer')` / `('saas_processor_terms')` results and rejects with 409 `version_changed` if either differs. Two consent rows are written transactionally (or neither) — see Closure #6 for the TX shape.

### Closure #4 (BLOCKER#4 — unbind must remain opt-out escape hatch)

**Fact:** §0z row at line 33 ("`lib/teacher-telegram-bind/actions.ts` (round-9 BLOCKER#2) | EXTEND") gates BOTH `bindTeacherTelegramAndCreateChannel` (line 62) AND `unbindTeacherTelegram` (line 117). That is wrong — a teacher caught without current consent must STILL be able to stop Telegram delivery.

**Closure:** the gate applies ONLY to `bindTeacherTelegramAndCreateChannel` (line 62). `unbindTeacherTelegram` (line 117) is explicitly excluded from the gate; document this exclusion in the plan and the code comment. The Telegram webhook teacher-branch consume path at `app/api/telegram/webhook/route.ts:154+205` is similarly gated only on the bind side; the public `/stop` command (whichever path it routes through) is never gated.

### Closure #5 (BLOCKER#5 — evals registries)

**Fact:** `evals/PRODUCT_FLOWS.md:71-83` and `evals/URL_REDIRECT_CONTRACT.md:20-31,87-99` are mandatory contract files for new top-level routes (see `docs/plans/CRITICAL-PATH-INVENTORY.md`). The plan's §0z file list omits both.

**Closure:** add the following to the Sub-A.2 (or Sub-A.3, whichever ships the new routes) file list:
- `evals/PRODUCT_FLOWS.md` — EXTEND: add `/saas-offer-accept` (existing-teacher acceptance interstitial), `/saas-offer-awaiting` (operator-flipped-flag-before-publishing-v1 holding page), `/admin/settings/saas-offer` (operator surface if/when it exists).
- `evals/URL_REDIRECT_CONTRACT.md` — EXTEND: pin the redirect ladder for each verdict (`ok` → `/teacher`; `consent_required` → `/saas-offer-accept`; `awaiting_publication` → `/saas-offer-awaiting`; anonymous → `/login`; non-teacher → role-appropriate redirect).

Without these entries the new routes ship outside the eval contract and break the project's URL audit.

### Closure #6 (BLOCKER#6 — evaluateSaasOfferGate snapshot)

**Fact:** `lib/auth/guards.ts:360-396` implements `evaluateSaasOfferGate` as two independent reads (`getCurrentLegalVersion('saas_offer')` then `getActiveConsent(...)`). For SSR this is acceptable (the redirect surface is idempotent). For the mutating `/api/teacher/**` perimeter — which this plan elevates the gate to — the two-read window allows a stale consent row to slip through one mutation between version-publish and consent-revalidation.

**Closure:** introduce a single TX-bound snapshot shape for the mutation gate. New helper `evaluateSaasOfferGateForMutation(accountId): Promise<GateVerdict>` (separate from `evaluateSaasOfferGate` to keep SSR perf):

```typescript
// lib/auth/guards.ts (new helper; coexists with evaluateSaasOfferGate)
export async function evaluateSaasOfferGateForMutation(
  accountId: string,
): Promise<GateVerdict> {
  const pool = getAuthPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set transaction isolation level repeatable read')
    const res = await client.query<{
      live_offer_id: string | null
      consent_offer_id: string | null
      live_terms_id: string | null
      consent_terms_id: string | null
    }>(
      `select
         (select id from legal_document_versions
            where doc_kind = 'saas_offer' and is_active = true limit 1) as live_offer_id,
         (select document_version_id from account_consents
            where account_id = $1::uuid and document_kind = 'saas_offer'
            order by accepted_at desc limit 1) as consent_offer_id,
         (select id from legal_document_versions
            where doc_kind = 'saas_processor_terms' and is_active = true limit 1) as live_terms_id,
         (select document_version_id from account_consents
            where account_id = $1::uuid and document_kind = 'saas_processor_terms'
            order by accepted_at desc limit 1) as consent_terms_id`,
      [accountId],
    )
    await client.query('commit')
    const row = res.rows[0]
    // Decision tree:
    //   live IS NULL → awaiting_publication
    //   live IS NOT NULL AND consent IS NULL → consent_required
    //   live != consent → consent_required (version drifted)
    //   live == consent → ok (for this kind)
    // Both kinds must be 'ok' to return overall ok.
    // ...
  } finally {
    client.release()
  }
}
```

The repeatable-read isolation level guarantees the two-document snapshot is consistent within the gate read. The mutation route calls this helper inside its own write TX (so the gate verdict is part of the same transaction that does the mutation — a publish-v2 commit that lands between gate and mutation is invisible to the mutation TX, which fails the gate and rolls back cleanly).

Regression test: integration case that publishes v2 between gate-read and mutation-write (via two concurrent connections) — old code lets the stale-consent mutation commit, new code rolls it back.

### Closure #7 (WARN — saas_offer_accepted audit emit)

**Fact:** `app/api/teacher/saas-offer-accept/route.ts:91-101` currently writes only `recordConsent()`. The audit event type `auth.teacher.saas_offer_accepted` is already in the SQL CHECK + the TS `AUTH_AUDIT_EVENT_TYPES` allowlist (`lib/audit/auth-events.ts:27-37`), but no writer emits it.

**Closure:** the accept handler MUST emit the audit event alongside the consent row:

```typescript
// app/api/teacher/saas-offer-accept/route.ts (post-recordConsent)
await recordAuthAuditEvent({
  eventType: 'auth.teacher.saas_offer_accepted',
  accountId: teacher.id,
  email: teacher.email,
  clientIp: getClientIp(request),
  userAgent: request.headers.get('user-agent'),
  payload: {
    consentVersionId: liveVersionId,
    documentKind: 'saas_offer',
  },
})
// And mirror for saas_processor_terms when the bundle requires both.
```

The audit emit is part of the same route handler scope; if `recordConsent` succeeds, `recordAuthAuditEvent` must also succeed (or be retried best-effort — the consent row is the source of truth, the audit row is the forensic trail). Do NOT couple them in a hard TX; the audit recorder is already silent-skip on missing pool per `lib/audit/auth-events.ts:81-86`.

---

**Status after §0ac applied:** round-8 BLOCKER findings each have a written closure. Round-9 codex run will verify: (a) closures don't contradict each other, (b) closures don't open new BLOCKERs, (c) all 6 BLOCKERs + 1 WARN are addressed.

---

## §0ad — Round-9 corrections (2026-06-04, supersede contradictions in §0ac)

Round 9 surfaced 3 BLOCKERs + 2 WARNs that hit §0ac directly:
- Closure #2 introduced an unbacked "two consent rows" claim that contradicts the live single-row + `combinedVersion` shape at `app/api/auth/register/route.ts:388`.
- Closure #6 SQL referenced columns that do not exist (used `is_active` + `document_version_id` instead of `effective_from` + `legal_document_version_id`) per `migrations/0032_legal_document_versions.sql:28-60` and `lib/auth/consents.ts:47`. The BEGIN/COMMIT inside the helper also contradicted the "runs inside route's write TX" claim.
- Closure #3 wrote new authoritative text but didn't mark older inline sections (lines 268, 277, 789) as superseded, so an implementer could still follow the stale one-doc path.

This section is the authoritative corrigendum. Where §0ad contradicts §0ac, §0ad wins.

### Corrigendum #1 — consent row shape stays SINGLE

The live `/register` flow at `app/api/auth/register/route.ts:153,164,388` reads BOTH `saas_offer` and `saas_processor_terms` live versions (TOCTOU at lines 178-186 pins both), then writes ONE `account_consents` row with `documentKind='saas_offer'` and a string-encoded `combinedVersion = "saas_offer:${saasOfferLabel}+processor_terms:${processorTermsLabel}"`. This is the source of truth — NOT two rows.

§0ac Closure #2 claim "two consent rows written transactionally (or neither)" is INCORRECT and is dropped. The actual contract is:

- Live-version reads: BOTH `saas_offer` AND `saas_processor_terms` via `getCurrentLegalVersion()`.
- TOCTOU pin: BOTH version IDs in the POST body, both compared to live.
- Consent row: SINGLE row, `documentKind='saas_offer'`, `documentVersion = combinedVersion` string. Backward-compatible — no migration needed; no existing cohort invalidated.
- The `/saas-offer-accept` interstitial currently only reads `saas_offer` (`app/api/teacher/saas-offer-accept/route.ts:70`); EXTEND to also read `saas_processor_terms`, compute the same `combinedVersion`, and write that string. This is a real gap covered by Closure #7 — and now also by this corrigendum.

### Corrigendum #2 — gate helper uses correct schema + injected client

§0ac Closure #6 SQL is rewritten to the actual schema and to take an injected client (no own TX management):

```typescript
// lib/auth/guards.ts (new helper; coexists with the SSR-side evaluateSaasOfferGate)
export async function evaluateSaasOfferGateForMutation(
  client: PoolClient,  // INJECTED — caller controls TX scope
  accountId: string,
): Promise<GateVerdict> {
  // Caller has already done `BEGIN` + `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`
  // (or stronger). Helper does ONE read and returns; no BEGIN/COMMIT here.
  const res = await client.query<{
    live_offer_label: string | null
    consent_offer_version_id: string | null
    live_terms_label: string | null
    consent_terms_version_id: string | null
  }>(
    `select
       (select version_label
          from legal_document_versions
         where doc_kind = 'saas_offer'
         order by effective_from desc
         limit 1) as live_offer_label,
       (select legal_document_version_id
          from account_consents
         where account_id = $1::uuid
           and document_kind = 'saas_offer'
         order by accepted_at desc
         limit 1) as consent_offer_version_id,
       (select version_label
          from legal_document_versions
         where doc_kind = 'saas_processor_terms'
         order by effective_from desc
         limit 1) as live_terms_label,
       (select legal_document_version_id
          from account_consents
         where account_id = $1::uuid
           and document_kind = 'saas_processor_terms'
         order by accepted_at desc
         limit 1) as consent_terms_version_id`,
    [accountId],
  )
  const row = res.rows[0]
  if (row.live_offer_label === null || row.live_terms_label === null) {
    return { verdict: 'awaiting_publication' }
  }
  if (row.consent_offer_version_id === null) {
    // No consent row at all; we use a SINGLE consent row keyed on
    // 'saas_offer' which carries `combinedVersion`; the
    // saas_processor_terms entry in account_consents is the
    // bundle's expansion path only if/when we split.
    return { verdict: 'consent_required' }
  }
  // Resolve the consent row's documentVersion string and compare
  // its embedded processor_terms label to the live one. The encoded
  // shape is "saas_offer:<offer_label>+processor_terms:<terms_label>";
  // mismatch on either segment → consent_required.
  // Implementation in lib/legal/combined-version.ts (new helper).
  // ...
  return { verdict: 'ok' }
}
```

Notes:
- Caller (mutating `/api/teacher/**` route) starts its own write TX at `REPEATABLE READ`, calls this helper, and ABORTS the TX with `rollback` if the verdict is anything but `ok`. If `ok`, the route's writes happen in the same TX — publish-v2 that lands between gate-read and route-writes is invisible (snapshot-isolation gives a clean fail).
- The current 2-read SSR helper (`lib/auth/guards.ts:383`) is NOT replaced; both helpers coexist.
- New helper file `lib/legal/combined-version.ts` exports `parseCombinedVersion(combinedVersionString): { saasOfferLabel: string; processorTermsLabel: string } | null` plus `buildCombinedVersion(offerLabel, termsLabel): string` (matches the encoding at `app/api/auth/register/route.ts:388`).

Regression test: integration case where publish-v2 of `saas_processor_terms` lands AFTER gate-read but BEFORE route-write on the same connection — gate verdict still `ok` (snapshot), route writes commit, NEXT request on the same account hits `consent_required` (fresh snapshot reads the new live label).

### Corrigendum #3 — §0ac authority markers on older inline sections

The older inline contracts at lines 268 (`saasOfferConsentVersionId` only) and 789 (Day-2 rollout publishing only `saas_offer`) are NOT manually rewritten here. Instead, this corrigendum declares: **any reader of this plan MUST treat §0ac + §0ad as the canonical contract for the gate, consent shape, and rollout. Older inline sections are historical drafting and DO NOT supersede §0ac/§0ad even when more specific.**

Specifically: lines 262-299 (Sub-A.3/A.5 version-TOCTOU) and lines 780-805 (Day-2 rollout) keep their wording but their authority is downgraded to "draft notes — see §0ac + §0ad for the final contract." The implementer ships per §0ac + §0ad.

### Corrigendum #4 — eval registries include /saas/processor-terms

Round-9 WARN #4 closure: the evals additions in §0ac Closure #5 are extended to include the processor-terms route:

- `evals/PRODUCT_FLOWS.md` — EXTEND: add `/saas-offer-accept`, `/saas-offer-awaiting`, `/admin/settings/saas-offer`, AND `/saas/processor-terms` (the second public doc).
- `evals/URL_REDIRECT_CONTRACT.md` — EXTEND: same set; `/saas/processor-terms` is `200` for everyone (public).

### Corrigendum #5 — Epic B Pricing card count

Round-9 WARN #5 closure: §8 already cuts Operator-managed, but body sections at line 646 (4-card spec) and line 754 (4-card test) remain stale. Bring §8 into the implementation contract:

- Line 646: pricing block renders 3 cards (`Free / Mid / Pro`), NOT 4.
- Line 754: `tests/saas-pivot/landing.test.tsx` asserts 3 cards.
- §8 (line 877) is canonical; older 4-card text is historical and overridden.

(These changes don't need a separate edit pass — the implementer reads §8 + this corrigendum as authoritative; lines 646/754 are flagged here for the impl PR's review checklist.)

---

**Status after §0ad applied:** round-9 BLOCKER findings each have a written closure that cites the actual schema + the real consent-row shape. Round-10 codex run will verify: (a) §0ad doesn't open new BLOCKERs, (b) all 3 round-9 BLOCKERs + 2 WARNs are addressed, (c) the gate-helper contract is implementable as written.

---

## §0ae — Round-10 escalation (2026-06-04, ESCALATED — STOP and surface to owner)

Round 10 returned BLOCK with 6 BLOCKERs + 1 INFO. Findings expose three different classes of issues that this plan-paranoia loop cannot self-close:

### Class A — §0ad fixable inconsistencies (4 BLOCKERs)

Each requires a §0ad rewrite but is mechanical:

1. **Corrigendum #2 self-contradiction** — helper still models `account_consents.document_kind='saas_processor_terms'`; canonical shape (per Corrigendum #1) is SINGLE row with `document_kind='saas_offer'` and `document_version = combinedVersion`. Fix: rewrite the gate query to read the single saas_offer consent row + parse the embedded combinedVersion to recover both labels; compare each to its respective live label.
2. **Live-version query missing `effective_from <= now()` + tie-break** — fix: add `where effective_from <= now() order by effective_from desc, created_at desc limit 1` to match the canonical `getCurrentLegalVersion()` shape (`lib/legal/versions.ts:51`).
3. **Latest consent missing `revoked_at IS NULL`** — fix: add the filter to mirror `getActiveConsent()` (`lib/auth/consents.ts:127`).
4. **Backfill script writes `documentVersion='v1'`** — incompatible with combinedVersion gate. Fix: backfill writes `documentVersion = buildCombinedVersion(saas_offer_v1_label, saas_processor_terms_v1_label)` so the cohort lines up with new writes.

### Class B — incomplete TOCTOU rewrite (1 BLOCKER)

5. **§0ad declared old sections "draft-only" without writing the concrete replacement** for the second TOCTOU pin (`saasProcessorTermsConsentVersionId`). The `/register` page already reads both live versions (`app/api/auth/register/route.ts:153+164`) but the POST contract + form-side pin + 409 validation for the second id is not specified. Fix: write the explicit GET-side rendering (form receives both ids), POST-side validation (both ids compared, either drift → 409), and 409-recovery UX (which side drifted? both?). This is a full Sub-section rewrite (~50-80 lines of plan).

### Class C — fundamental race (1 BLOCKER) — REQUIRES DESIGN DECISION

6. **REPEATABLE READ does NOT close the publish-v2 race**, contrary to §0ad's claim. Under REPEATABLE READ, a route TX started BEFORE publish-v2's commit sees the old snapshot, passes the gate, and commits the mutation. The next request hits `consent_required` (fresh snapshot reads the new live label), but the previous mutation already committed without re-consent.

Possible designs:
- **(a) Accept the narrowed leak.** Mutations between gate-read and route-commit are bounded to one TX's window (usually <100ms); documentation states this is acceptable and ships with this risk pinned. *Trade-off: small race window remains, but doc-level honest.*
- **(b) SERIALIZABLE isolation on mutation route.** Stronger than REPEATABLE READ; the publish-v2 commit conflicts on the read set, forcing a retry of the mutation TX. *Trade-off: increased deadlock/retry cost; needs explicit retry loop in routes.*
- **(c) Advisory lock pattern.** Publish-v2 takes an advisory lock; gate-check acquires SHARED of the same lock. Concurrent publish-v2 and gate-check serialize. *Trade-off: requires plumbing the lock through every mutating route.*
- **(d) Consent stamp + SELECT FOR UPDATE.** Mutation route does `SELECT consent_id FROM account_consents WHERE account_id=$1 AND ...not revoked FOR UPDATE` inline before its writes; publish-v2 acquires update lock on the same row to invalidate. *Trade-off: requires schema change (or stamp column) + every mutation route to do the consent lock.*

**This requires owner / architecture decision.** Plan-paranoia cannot self-close — it's a real design call.

### Round-10 final state

- 10 rounds run total.
- 4 Class-A items: mechanical, can be closed in §0af.
- 1 Class-B item: needs a Sub-section rewrite (~80 plan lines).
- 1 Class-C item: needs owner / architecture decision before §0af can finalize.

**Status:** ESCALATED — STOP per `/codex-paranoia §4.2`. Do NOT proceed to implementation until the owner decides Class-C design and §0af is written + verified by a round-11 codex pass.

**Final paranoia trailer for any future commit on this branch:**

```
Codex-Paranoia: ESCALATED round 10/3 — 1 BLOCKER (Class C race) requires owner design decision (see §0ae options a-d)
```

**For the implementation epic this plan would feed:** treat Class C as a separate "publish-vs-mutation race" design epic; the SaaS-offer plan body remains valid for the legal / consent / TOCTOU portions IF Class A + Class B are closed via §0af AND Class C lands its own design decision.
