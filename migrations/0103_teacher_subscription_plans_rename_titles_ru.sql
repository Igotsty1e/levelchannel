-- bug-4 Sub-PR A — rename public title_ru on teacher_subscription_plans.
--
-- Plan: docs/plans/bug-4-tariff-naming-and-ui.md §Decision.
--
-- 3 public-facing SaaS tier titles get Russian names; the canonical
-- DB slugs (free / mid / pro / operator-managed) DO NOT change. Any
-- code that joins / filters / FKs on the slug column is unaffected.
--
--   free  → 'Стартовый'    (was 'Free')
--   mid   → 'Базовый'      (was 'Mid')
--   pro   → 'Расширенный'  (was 'Pro')
--   operator-managed       — UNCHANGED (admin-only, not a public tier)
--
-- Idempotent. The WHERE clause guards re-run: rows already on the new
-- title are skipped, so running this migration twice (or after a
-- manual partial fix) is safe.

update teacher_subscription_plans
   set title_ru = 'Стартовый',
       updated_at = now()
 where slug = 'free'
   and title_ru is distinct from 'Стартовый';

update teacher_subscription_plans
   set title_ru = 'Базовый',
       updated_at = now()
 where slug = 'mid'
   and title_ru is distinct from 'Базовый';

update teacher_subscription_plans
   set title_ru = 'Расширенный',
       updated_at = now()
 where slug = 'pro'
   and title_ru is distinct from 'Расширенный';
