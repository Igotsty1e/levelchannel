-- ─── SQL recipes для аналитики ─────────────────────────────────────────
--
-- Все запросы ДОЛЖНЫ начинаться с `WHERE occurred_at >= …` для partition pruning.
-- Без этого PostgreSQL сканирует все партиции.
--
-- Используем view `events_resolved` (после создания) — она COALESCE'ит
-- account_id и anonymous_id в единый person_key. Для phase 1 events_resolved
-- может отсутствовать — replace на `events` напрямую с `COALESCE(account_id::text, anonymous_id::text) AS person_key`.

-- ─── 1. DAU/MAU (анонимы вкл./выкл.) ───────────────────────────────────

-- DAU за последние 30 дней (только identified)
select
  date_trunc('day', occurred_at) as day,
  count(distinct account_id) as dau_identified
from events
where occurred_at >= now() - interval '30 days'
  and account_id is not null
group by 1
order by 1 desc;

-- DAU включая anonymous (по anonymous_id если account_id null)
select
  date_trunc('day', occurred_at) as day,
  count(distinct coalesce(account_id::text, anonymous_id::text)) as dau_all
from events
where occurred_at >= now() - interval '30 days'
group by 1
order by 1 desc;

-- ─── 2. Funnel: лендинг → регистрация → платная подписка ───────────────

with steps as (
  select
    coalesce(account_id::text, anonymous_id::text) as person_key,
    event_name,
    min(occurred_at) as first_at
  from events
  where occurred_at >= now() - interval '30 days'
    and event_name in ('hero_cta_clicked', 'signup_completed', 'payment_widget_opened')
  group by 1, 2
),
pivoted as (
  select
    person_key,
    min(case when event_name = 'hero_cta_clicked' then first_at end) as s1_hero,
    min(case when event_name = 'signup_completed' then first_at end) as s2_signup,
    min(case when event_name = 'payment_widget_opened' then first_at end) as s3_pay
  from steps
  group by 1
)
select
  count(*) filter (where s1_hero is not null) as s1_hero_users,
  count(*) filter (where s2_signup is not null and s2_signup >= s1_hero) as s2_signup_users,
  count(*) filter (where s3_pay is not null and s3_pay >= s2_signup) as s3_paid_users,
  round(100.0 * count(*) filter (where s2_signup is not null and s2_signup >= s1_hero)
              / nullif(count(*) filter (where s1_hero is not null), 0), 2) as pct_hero_to_signup,
  round(100.0 * count(*) filter (where s3_pay is not null and s3_pay >= s2_signup)
              / nullif(count(*) filter (where s2_signup is not null), 0), 2) as pct_signup_to_paid
from pivoted;

-- ─── 3. Pricing tier клики — какой тариф интереснее? ───────────────────

select
  properties->>'tier_name' as tier,
  count(*) as clicks,
  count(distinct coalesce(account_id::text, anonymous_id::text)) as unique_users
from events
where occurred_at >= now() - interval '30 days'
  and event_name = 'pricing_tier_clicked'
group by 1
order by clicks desc;

-- ─── 4. UTM attribution — откуда приходят регистрации ──────────────────

with first_touch as (
  select
    coalesce(account_id::text, anonymous_id::text) as person_key,
    utm->>'source' as utm_source,
    utm->>'medium' as utm_medium,
    utm->>'campaign' as utm_campaign,
    min(occurred_at) as first_seen_at
  from events
  where occurred_at >= now() - interval '90 days'
    and event_name = 'page_view'
    and utm->>'source' is not null
  group by 1, 2, 3, 4
)
select
  utm_source,
  utm_campaign,
  count(*) as users,
  count(*) filter (
    where exists (
      select 1 from events e2
      where e2.occurred_at >= now() - interval '90 days'
        and e2.event_name = 'signup_completed'
        and coalesce(e2.account_id::text, e2.anonymous_id::text) = ft.person_key
    )
  ) as signups
from first_touch ft
group by 1, 2
order by signups desc nulls last;

-- ─── 5. Week-over-week retention ───────────────────────────────────────

with cohorts as (
  select
    coalesce(account_id::text, anonymous_id::text) as person_key,
    date_trunc('week', min(occurred_at)) as cohort_week
  from events
  where occurred_at >= now() - interval '12 weeks'
  group by 1
),
activity as (
  select
    coalesce(account_id::text, anonymous_id::text) as person_key,
    date_trunc('week', occurred_at) as active_week
  from events
  where occurred_at >= now() - interval '12 weeks'
)
select
  c.cohort_week,
  a.active_week,
  extract(week from a.active_week - c.cohort_week)::int as week_offset,
  count(distinct c.person_key) as users
from cohorts c
join activity a using (person_key)
group by 1, 2
order by 1, 2;

-- ─── 6. User timeline — что делал юзер X? ──────────────────────────────

-- Replace '<account-uuid>' or feed по anonymous_id если pre-signup.
select
  occurred_at,
  event_name,
  url,
  session_id,
  properties
from events
where occurred_at >= now() - interval '90 days'
  and account_id = '<account-uuid>'
order by occurred_at desc
limit 100;

-- ─── 7. Topic-based: какие SEO-страницы конвертят? ─────────────────────

select
  url,
  count(*) as views,
  count(distinct coalesce(account_id::text, anonymous_id::text)) as unique_visitors
from events
where occurred_at >= now() - interval '30 days'
  and event_name = 'page_view'
  and url like '/saas/learn/%'
group by 1
order by views desc;

-- ─── 8. Drop-off на pricing — кликал но не зарегался ───────────────────

with pricing_clickers as (
  select
    coalesce(account_id::text, anonymous_id::text) as person_key,
    max(occurred_at) as last_pricing_click
  from events
  where occurred_at >= now() - interval '30 days'
    and event_name = 'pricing_tier_clicked'
  group by 1
),
signed_up as (
  select coalesce(account_id::text, anonymous_id::text) as person_key
  from events
  where occurred_at >= now() - interval '30 days'
    and event_name = 'signup_completed'
)
select
  count(distinct p.person_key) as total_pricing_clickers,
  count(distinct s.person_key) as also_signed_up,
  count(distinct p.person_key) - count(distinct s.person_key) as dropped_off
from pricing_clickers p
left join signed_up s using (person_key);

-- ─── 9. Session duration — avg время в кабинете для платников ──────────

with sessions as (
  select
    session_id,
    account_id,
    min(occurred_at) as started_at,
    max(occurred_at) as last_at
  from events
  where occurred_at >= now() - interval '30 days'
    and account_id is not null
    and url like '/cabinet/%' or url like '/teacher/%'
  group by 1, 2
)
select
  date_trunc('week', started_at) as week,
  avg(extract(epoch from (last_at - started_at)))::int as avg_session_seconds,
  count(*) as session_count
from sessions
where last_at > started_at + interval '5 seconds'
group by 1
order by 1 desc;

-- ─── 10. Топ-события по объёму (для понимания шума) ────────────────────

select
  event_name,
  count(*) as total,
  count(distinct coalesce(account_id::text, anonymous_id::text)) as unique_users,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct_of_total
from events
where occurred_at >= now() - interval '7 days'
group by 1
order by 2 desc
limit 50;
