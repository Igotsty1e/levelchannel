-- mig 0134 — A.1 tariff reprice 2026-06-18 (owner-backlog: free 3 учеников,
-- mid → «Оптимальный» 399 ₽ без лимита). Pro DB row не трогаем — он остаётся
-- для legacy operator-managed раздачи + истории платежей; в публичных
-- UI (/saas, /teacher/subscription) Pro перестаёт показываться через TS-фильтр.
--
-- Plan: docs/plans/tariff-reprice-2026-06-18.md.
--
-- Idempotent: повторное применение не сломает строки уже-обновлённые
-- (UPDATE ... WHERE условия фильтруют по старым значениям).

do $migration$
declare
  v_free_updated integer;
  v_mid_updated integer;
begin
  -- (1) Free → Стартовый, лимит 1 → 3 учеников.
  --     title_ru уже «Free» из mig 0103, оставляем как-есть в SoT
  --     (titleRu в TS даёт «Стартовый»); поднимаем лимит.
  update teacher_subscription_plans
     set learner_limit = 3
   where slug = 'free'
     and learner_limit = 1;
  get diagnostics v_free_updated = row_count;
  raise notice 'mig 0134: free learner_limit 1→3 — % row(s) updated', v_free_updated;

  -- (2) Mid → «Оптимальный»: title_ru, price 30000→39900 (399 ₽),
  --     learner_limit 5 → NULL (без ограничения).
  update teacher_subscription_plans
     set title_ru = 'Оптимальный',
         price_kopecks_monthly = 39900,
         learner_limit = null
   where slug = 'mid'
     and title_ru = 'Mid'
     and price_kopecks_monthly = 30000
     and learner_limit = 5;
  get diagnostics v_mid_updated = row_count;
  raise notice 'mig 0134: mid → Оптимальный 399₽ без лимита — % row(s) updated', v_mid_updated;

  -- (3) Pro строка остаётся без изменений на уровне БД.
  --     Публичные UI (TS-уровень, см. app/teacher/subscription/page.tsx
  --     + components/saas/landing-v3/screens/08-pricing.tsx) перестают
  --     рендерить Pro карточку. operator-managed flow продолжает работать.
end
$migration$;
