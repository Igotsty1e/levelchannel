# SaaS-pivot teacher-landing — research inventory

**Status:** discovery-only (read-only research pass, 2026-05-21).
**Author:** Claude (research-discovery agent).
**Purpose:** answer "what user research do we already have that would inform a NEW landing page targeted at TEACHERS (not learners)?" before any copy/design work begins.
**Scope:** inventory only. No copy drafted, no design proposed.

---

## 1. Source inventory

Legend: **R** = user research / market research / competitive research with named sources; **S** = internal product strategy / engineering plan; **P** = product / persona description (internal claims, not interview-backed); **L** = legacy / historical (current product is past it); **C** = current landing copy.

| File | Class | Topic | One-line summary |
|---|---|---|---|
| `/Users/ivankhanaev/Obsidian/Brain/Research/Level Channel/Competitors/2026-05-20 - Booking SaaS for Tutors - RU CIS Competitive Research.md` | **R** | Booking SaaS for tutors, RU/CIS competitive map + landing teardown | Deep competitive research: 11 competitors profiled, landing-page must-haves derived, GTM channels, MVP phasing, North Star metric — explicitly written for a tutor-targeted SaaS pivot. **The only research artefact that maps to the new teacher-landing problem.** |
| `/Users/ivankhanaev/LevelChannel/docs/backlog/saas-pivot.md` | **S** | SaaS pivot scope SAAS-1…SAAS-6 (added by product owner 2026-05-18) | Defines the product pivot from single-channel to multi-teacher SaaS. **L17 (line 16)**: «CONFLICT-FEED — defer» mentions the gate is "когда на проде появится ≥3 учителей" — this is a quantitative product target, not user research. |
| `/Users/ivankhanaev/LevelChannel/docs/plans/teacher-self-reg-invite.md` | **S** | SAAS-3+4 teacher self-reg + invite link epic plan (shipped) | Implementation plan for the self-service teacher signup; describes what teachers can DO post-pivot but contains zero teacher-user research. |
| `/Users/ivankhanaev/LevelChannel/docs/plans/cabinet-profile-button.md` | **S** | SAAS-5 cabinet IA cleanup (shipped) | Internal IA refactor; no teacher voice. |
| `/Users/ivankhanaev/LevelChannel/docs/plans/calendar-apple-redesign.md` | **S** | SAAS-1 calendar redesign | Design plan, no research. |
| `/Users/ivankhanaev/LevelChannel/docs/content-style.md` | **P** | Russian copy style guide + 40-entry forbidden-words glossary + audience matrix | Defines three internal audiences (Учащийся / Учитель / Оператор) with vocabulary tolerances and tone — **§2 Audience Matrix L48-54** is the closest thing we have to an internal teacher persona, but it is asserted by the doc author, not interview-backed. |
| `/Users/ivankhanaev/LevelChannel/docs/design-system.md` | **P** | Design system v1 (Apple HIG-inspired tokens) | Marketing surfaces are **explicitly out of scope** (L33-34): «Marketing/landing surfaces beyond the SaaS shell» is excluded. |
| `/Users/ivankhanaev/LevelChannel/components/home/home-page-client.tsx` | **C** | Current `/` landing (LearnerAnastasia-coach landing) | The entire current landing surface — 1103 lines, learner-facing, single-teacher (Анастасия), Telegram-CTA-only, no booking widget. |
| `/Users/ivankhanaev/LevelChannel/docs/private/PRD.private.md` | **L** | Historical first-version landing PRD | **L1-9 marks it explicitly historical**. Describes the learner-facing landing for Anastasia (1:1 lessons, Telegram lead-gen, SBP pay, 3500/5000₽ pricing). **The current `home-page-client.tsx` is the live implementation of this PRD. Nothing here addresses teacher acquisition.** |
| `/Users/ivankhanaev/LevelChannel/PRD.md` | — | Pointer file | Just a 18-line redirect to README/docs/public. |
| `/Users/ivankhanaev/LevelChannel/ROADMAP.md` | **S** | Outcome-level priorities | P0 compliance + ops; P1 operator visibility; P2 operator tooling. No teacher-acquisition / GTM layer mentioned. |
| `/Users/ivankhanaev/LevelChannel/docs/public/ROADMAP.md` | **S** | Public roadmap | Describes shipped May 2026 wave + near-term. Zero teacher GTM. |
| `/Users/ivankhanaev/LevelChannel/README.md` | **S** | Current product orientation | **L7**: «aimed at small education businesses that need a direct landing-to-payment funnel» — this is the only explicit "who is the customer" line in tracked docs, but it is positioning copy, not research. |
| `/Users/ivankhanaev/Obsidian/Brain/wiki/entities/levelchannel.md` | **S** | Brain entity card for LevelChannel | Engineering-discipline focus; no user/market research. |
| `/Users/ivankhanaev/Obsidian/Brain/raw/notes/*-codex-paranoia-*` (20+ files) | **S** | Per-epic adversarial review logs | All implementation-oriented; zero teacher-side user research. |
| `/Users/ivankhanaev/Obsidian/Brain/raw/articles/2026-05-03-pg-how-to-get-startup-ideas.md` | — | Saved external reading (PG essay) | Generic startup-idea framework, not LevelChannel-specific. |

**Directories checked and confirmed empty of teacher user-research:**

- `/Users/ivankhanaev/LevelChannel/docs/` (top-level) — no `research*.md`, no `interview*.md`, no `personas*.md`, no `discovery*.md`.
- `/Users/ivankhanaev/LevelChannel/docs/plans/` — 41 files, all engineering plans.
- `/Users/ivankhanaev/LevelChannel/docs/backlog/` — engineering backlog only.
- `/Users/ivankhanaev/LevelChannel/docs/public/` — only `ARCHITECTURE.md`, `ROADMAP.md`, `AI_WORKFLOW.md`.
- `/Users/ivankhanaev/LevelChannel/docs/private/` — only `PRD.private.md` (historical, learner-facing) and `OPERATIONS.private.md`.
- `/Users/ivankhanaev/LevelChannel/docs/legal/` — `retention-policy.md` only.
- `/Users/ivankhanaev/Obsidian/Brain/raw/transcripts/` — **empty** (no interview transcripts on disk).
- `/Users/ivankhanaev/Obsidian/Brain/raw/books/` — **empty**.
- `/Users/ivankhanaev/Obsidian/Brain/Research/Level Channel/` — contains only the `Competitors/` sub-directory with one file (the 2026-05-20 deep-research doc above). No `Interviews/`, no `Personas/`, no `Surveys/`.

**Obsidian Brain accessibility:** **OK** — read access works; full Brain tree enumerated.

---

## 2. Teacher persona — what we know

**Direct quotes from internal source material (no actual interview/survey transcripts on disk):**

- **Audience matrix description, asserted by content-style author:** «Преподаватель английского. Часто билингв, но Russian-first в нашем интерфейсе. Средняя [vocabulary tolerance]. Может стерпеть "расписание", "занятие", "слот в расписании", "инвайт". Финансовая телеметрия: "реконсилиация", "postpaid", "paid_not_granted" [— gets confused by]. "Вы", деловой, без панибратства.»  — `/Users/ivankhanaev/LevelChannel/docs/content-style.md:53`.
- **Empty-state copy assumes a teacher with no learners is a normal first-time state:** «Учитель, нет учеников: "За вами пока не закреплён ни один ученик…"» — `/Users/ivankhanaev/LevelChannel/docs/content-style.md:209-210`.
- **Implicit ICP segment, from product positioning:** «aimed at small education businesses that need a direct landing-to-payment funnel with legal consent capture, webhook-backed payment handling, and room for a future learner cabinet.» — `/Users/ivankhanaev/LevelChannel/README.md:7`.
- **Tutor segment + adjacent vertical, from competitive research:** «SaaS-подписка для преподавателей/репетиторов, РФ/СНГ, use case — расписание, запись ученика, оплаты/абонементы, напоминания, календарь, учёт занятий.» — `/Users/ivankhanaev/Obsidian/Brain/Research/Level Channel/Competitors/2026-05-20 - Booking SaaS for Tutors - RU CIS Competitive Research.md:20`.
- **Proposed product positioning targeting tutors of English specifically:** «"личный кабинет преподавателя английского: запись, уроки, оплаты и родительский контекст без Excel, хаоса в чатах и тяжёлой CRM"» — `/Users/ivankhanaev/Obsidian/Brain/Research/Level Channel/Competitors/2026-05-20 - Booking SaaS for Tutors - RU CIS Competitive Research.md:52`.
- **Inferred-from-market signals about user pain (drawn from competitor reviews, NOT our users):** «пользователи прямо говорят, что им нужна визуализация календаря "как в Google", перенос базы, нормальная оплата из РФ, ссылки на мессенджеры.» — `/Users/ivankhanaev/Obsidian/Brain/Research/Level Channel/Competitors/2026-05-20 - Booking SaaS for Tutors - RU CIS Competitive Research.md:145-146` (ЯРепетитор competitor profile).

**Honest assessment:**

- **No first-party teacher interviews, surveys, or persona docs exist in the repo or in the Brain.**
- The single piece of named research is **market/competitive research**, not user research. It draws on competitor App Store reviews and public marketing claims, not on conversations with LevelChannel's own prospective teacher users.
- Internal persona assertions (content-style §2) are author-stated, not interview-backed.
- **For the founder context: the live teacher is Анастасия (single teacher today). There is no documented evidence that a sample of N≥2 prospective teachers has been interviewed about why they would switch to LevelChannel.**

---

## 3. Pain points

**Pain points attributed to teachers/tutors in our material — almost entirely sourced from the 2026-05-20 competitive research's interpretation of competitor positioning, NOT from our own users.**

- **Booking-by-DM friction:** «Ученик пишет в Telegram, родитель платит после урока, вы переносите слот в календаре, баланс ведёте в таблице — и всё ломается.» — `2026-05-20 - Booking SaaS for Tutors...md:314-320` (proposed problem block, not transcribed from a user).
- **Four canonical pains the research recommends putting on the landing:**
  - «переписки по времени;»
  - «забытые оплаты;»
  - «переносы/отмены;»
  - «нет единой истории ученика.» — `2026-05-20 - Booking SaaS for Tutors...md:317-320`.
- **Pain attributed to competitor ЯРепетитор's user base (not ours):** «нет сильной landing/story для привлечения новых учеников.» — `2026-05-20 - Booking SaaS for Tutors...md:156`.
- **Pain claimed at the segment level (positioning, not field-research-derived):** «преподавателю/маленькой школе не нужна тяжёлая CRM» — `2026-05-20 - Booking SaaS for Tutors...md:380`.
- **Pain claimed against booking-only tools:** «Они решают "назначить встречу". Мы решаем "вести обучение как маленький бизнес".» — `2026-05-20 - Booking SaaS for Tutors...md:374` (against Планёрка/Calink/Фасти).

**Honest assessment:**

- **All pain points in the repo are hypothesized, not validated.** They are well-structured and plausible (the competitive research is thorough), but the chain is: competitor public marketing → research synthesis → assumed pain → recommended landing copy. No step in that chain involves our prospective teacher users describing the pain in their own words.
- **One internal corroboration signal exists** (`docs/backlog/saas-pivot.md:16`): the product owner deferred CONFLICT-FEED until «когда на проде появится ≥3 учителей ИЛИ operator не пожалуется на отсутствие /admin-видимости конфликтов» — implying we currently have <3 teachers on prod, which is consistent with «zero teacher interviews on disk».

---

## 4. Existing landing surface

**Current `/` landing — fully learner-targeted, single-teacher (Anastasia Coach) lead-gen via Telegram.**

Source: `/Users/ivankhanaev/LevelChannel/components/home/home-page-client.tsx` (1103 lines).

**Current H1** (`home-page-client.tsx:271-274`):

> «Английский под вашу цель — от экзамена до работы с иностранными клиентами»

**Current section sequence** (`home-page-client.tsx:1087-1100`):

1. `Header` — logo + nav: Форматы / Результаты / Обо мне / Цены + «Войти» + «Написать в Telegram» CTA.
2. `Hero` — H1 above + 3 learner-bullets («Подготовка к IELTS», «Английский для работы», «Разговорный английский») + Telegram CTA.
3. `TrustStats` — 8 лет / 10 000+ часов / 1:1 / ∞ мотивации.
4. `UseCases` («Для чего вам английский язык?») — 3 cards: Экзамены / Работа / Разговорный (`home-page-client.tsx:417-419`).
5. `Process` — 4 steps: Определение цели → Индивидуальный план → Занятия 1:1 → ДЗ + обратная связь.
6. `Results` — 5 учеников before/after (IELTS 4.5→6.5, B2→оффер, etc.).
7. `Teacher` — Anastasia bio + photo (`home-page-client.tsx:696-792`).
8. `Pricing` — «От 3 500 ₽ за занятие» + Telegram CTA + «Перейти к оплате» (deep-link to /pay).
9. `FinalCTA` — «Начните обучение под свою цель» + Telegram.
10. `Footer` — реквизиты, оферта, ПДн, согласие.

**Three "main" section headers (excluding hero/CTA chrome):**

1. «Для чего вам английский язык?» (UseCases) — `home-page-client.tsx:417`.
2. «Процесс обучения» (Process) — `home-page-client.tsx:499`.
3. «Реальные истории — реальный прогресс» (Results) — `home-page-client.tsx:611`.

**Which would be reused vs. replaced for a teacher-targeted landing:**

| Section | Reuse for teacher landing? | Reason |
|---|---|---|
| `Header` chrome | **Reuse** (rebrand CTA «Написать в Telegram» → «Создать аккаунт» / «Создать страницу записи»). | Layout, scroll behavior, login link are role-agnostic. |
| `Hero` | **Replace fully.** | H1 + bullets + CTA target speak to a learner buying English lessons. The competitive research proposes a hero showing «booking widget + teacher cabinet side-by-side» (`2026-05-20...md:312-313`). |
| `TrustStats` | **Replace.** | Anastasia's 8-year / 10k-hour numbers are her credentials, not a SaaS trust proof. Need product trust: # teachers, # bookings/mo, security badges. |
| `UseCases` | **Replace.** | Goals «IELTS / Работа / Разговорный» are learner goals. Teacher analog would be teacher use cases (solo tutor / repeat clients / mini-school / parent-managed kids). |
| `Process` | **Reframe.** | «Определение цели → план → занятия → ДЗ» = learning journey. Teacher analog: «Создайте страницу → ученики записываются сами → пакеты автоматически списываются → платежи приходят на ваш счёт». |
| `Results` | **Replace.** | Learner before/after stories. Teacher analog would be teacher revenue/time-savings stories — but **we don't have any teacher case studies in our material**. |
| `Teacher` (Anastasia bio) | **Drop entirely.** | Single-teacher product proof; doesn't survive the SaaS pivot. |
| `Pricing` | **Replace.** | Currently «3 500 ₽ за занятие» (lesson price). SaaS analog is a per-teacher subscription tier (Solo / Pro / Studio per competitive research §5.6, `2026-05-20...md:342-346`). |
| `FinalCTA` | **Reframe.** | Telegram-lead-gen → product sign-up. |
| `Footer` | **Reuse** (реквизиты / оферта / ПДн survive the pivot). | Legal surface is operator-side and stays. |

---

## 5. Gap analysis

**We have:**

- A thorough RU/CIS **competitive landscape map** with 11 competitors, weaknesses, and what to steal — `2026-05-20 - Booking SaaS for Tutors...md` §3.
- A **proposed landing structure with 9 must-have blocks** ready to be copywritten — `2026-05-20 - Booking SaaS for Tutors...md` §5 (Hero / Problem / How it works / Student-parent experience / Teacher cabinet / Pricing / Trust / Comparison / SEO pages).
- A working **Apple-HIG-inspired design token system** (`docs/design-system.md`) that any new landing can pull from — though the doc itself excludes marketing surfaces (L33-34).
- A working **Russian content-style guide with 40-entry forbidden glossary + audience matrix** (`docs/content-style.md`) usable for a teacher-targeted voice.
- A **live SaaS product shell** behind the landing: self-service teacher registration (SAAS-3 shipped), invite-link learner auto-bind (SAAS-4 shipped), `/admin` / `/teacher` / `/cabinet` surfaces, booking calendar, package billing, CloudPayments. The product the landing must sell is real and shippable.
- A clear **internal positioning sentence** in the competitive research: «личный кабинет преподавателя английского: запись, уроки, оплаты и родительский контекст без Excel, хаоса в чатах и тяжёлой CRM» (`2026-05-20...md:52`).

**We LACK:**

- **Zero first-party teacher interview transcripts.** No `interview-*.md`, no `discovery-*.md`, no `survey-*.md` files exist anywhere we searched.
- **Zero documented teacher personas** sourced from real conversations. The closest is `docs/content-style.md:53` — one-row table cell of asserted vocabulary tolerance, not a persona doc.
- **Zero teacher testimonial quotes.** Every Results / Teacher-quote slot on a SaaS landing needs verbatim teacher voice; we have none.
- **Zero pricing-anchored examples** for the teacher side. The 3500₽/lesson copy is learner-facing; we have no Solo / Pro / Studio tier copy ready, no per-active-learner pricing decided, no anchor figures («economy of N students = pays-for-itself in M weeks»).
- **No before/after teacher stories.** Anastasia's own story (her time saved by the platform) is not documented as a marketing artefact.
- **No segmented positioning copy.** Competitor research recommends separate landing pages for «репетитор английского / логопед / подготовка к ЕГЭ / групповые занятия» (`2026-05-20...md:87, 108`); we have zero variant copy drafted.
- **No SEO long-tail keyword research mapped to Russian search-volume data.** Competitor research lists ~6 candidate queries (`2026-05-20...md:425-430`) but does not validate them with search-volume / competition data.
- **No conversion-funnel hypothesis for the teacher side.** The current landing has a learner KPI («Leads per 100 visitors», `PRD.private.md:28-29`); no equivalent target is documented for teacher sign-ups.
- **No comparison table content.** Competitor research proposes a «vs Excel / vs Telegram / vs Google Calendar / vs CRM для школы / vs Calendly/Планёрка» block (`2026-05-20...md:354-359`) but does not draft the cells.
- **No interactive-booking-widget visual asset.** Competitor research strongly recommends a live mini-booking demo on the hero (`2026-05-20...md:313`); we have no design or storyboard for one.
- **No teacher onboarding-flow screen recordings or animated GIFs.** The product is shipped; no marketing-grade visual assets exist for it.
- **No founder-story / why-now narrative.** The competitive research mentions «Founder-led content: LinkedIn/VC/TenChat/Pikabu: "строю CRM для репетиторов и разбираю рынок"» (`2026-05-20...md:441-443`) as a GTM channel, but no founder-narrative draft exists.

---

## 6. Recommendation

**Honest take based on the inventory:**

- **The existing learner landing (`home-page-client.tsx`) CANNOT be retargeted to teachers by copy-swap.** Only the chrome (header, footer, animation primitives, design tokens) is role-agnostic. Every content block (Hero, TrustStats, UseCases, Process, Results, Teacher, Pricing, FinalCTA) is learner-shaped and will not survive a teacher rewrite intact.

- **We DO have one strong asset — the 2026-05-20 competitive deep-research doc.** It already proposes the full landing block structure (`2026-05-20...md` §5), differentiation language (§6), MVP phasing (§7), and GTM channels (§8). A teacher landing v1 could be drafted **directly from this document** without further user research — but it would be a research-informed market-positioning landing, **not a user-validated landing.**

- **Crucially, we do NOT have first-party teacher user research.** Every persona claim and pain-point in our material traces back to either (a) author-asserted internal claims (`docs/content-style.md`), or (b) interpretation of competitor App-Store reviews and competitor marketing copy (`2026-05-20...md`). Risk: we ship a landing that converts on hypothesized pain but discovers in real traffic that prospective Russian English tutors have a different #1 pain (e.g. tax/самозанятый compliance, learner-acquisition rather than learner-management, parents who pay vs students who book).

- **Recommended scope decision (3 options, ranked):**

  1. **Best:** run a short founder-driven research session — 5-8 calls with prospective Russian English tutors (LinkedIn / Telegram tutor-channels / Анастасия's network). Use Mom-Test format. Output: a `docs/research/teacher-interviews-2026-05.md` with verbatim quotes. **Then** draft the landing — landing copy lifts directly from quotes. Cost: ~1 week founder-time. Risk reduction: catches the wrong-pain-point failure mode before launch.

  2. **Acceptable middle:** draft a **v0 generic-positioning landing** straight from the competitive research now, ship as MVP, instrument hard (heatmaps, scroll-depth, CTA splits per the existing analytics events at `home-page-client.tsx:18-22, 98-117`), and treat the first 4-8 weeks of traffic as the research session. Pivot copy from observed-bounce hotspots. Cost: 1-2 days copy + design + paranoia. Risk: ships a hypothesized landing into a market we haven't talked to, but the cost of being wrong is recoverable copy iteration.

  3. **Not recommended:** ship the existing learner landing with a «для учителей» tab grafted on. We'd be selling a SaaS product (subscription, multi-teacher) through a lead-gen UX shape (Telegram DM to Anastasia). The mismatch is severe enough that conversion will be very noisy and we'll learn nothing.

- **Specific founder-time investment that would have the highest leverage right now:** record ONE 5-min screen-cap of Anastasia's actual day on the platform (открыла слоты → ученик записался → пакет списался → деньги пришли). That single asset, used as the Hero «How it works» demo, is worth more than several blocks of copy from the competitive research, because it shows the working product.

---

## Verdict

- **Inventory file path:** `/Users/ivankhanaev/LevelChannel/docs/plans/saas-pivot-landing-research-inventory.md` (this file).
- **Verdict on landing scope:** **(b) we have enough to build a generic value-prop landing without specific teacher research, sourced from the 2026-05-20 competitive deep-research doc. We do NOT have enough to claim it is a user-validated landing. Option (b) on §6 is the pragmatic call; option (a) is the higher-quality call if founder time allows a 1-week research sprint.**
