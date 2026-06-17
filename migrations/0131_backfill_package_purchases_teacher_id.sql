-- 2026-06-17 prod-fix — backfill NULL package_purchases.teacher_id.
--
-- Owner-report: «ученик не может забронировать занятие по пакету
-- (он у него есть)». Investigation showed: consumePackageUnit
-- (lib/billing/consumption.ts) фильтрует `pp.teacher_id = $3`, что
-- исключает legacy строки с teacher_id = NULL. Эти строки могли
-- появиться:
--   1. До mig 0083 (Day-1 backfill) — у некоторых рядов backfill
--      не сработал из-за порядка операций
--   2. Через admin-grant flow в редких edge-case
--
-- Эта миграция дополняет один cleanup-проход: для каждой строки
-- package_purchases с teacher_id IS NULL берём teacher_id из
-- lesson_packages (FK через package_id). Если у пакета тоже NULL —
-- оставляем (это совсем legacy случай).
--
-- Безопасно: append-only update, не разрушает данные. После этой
-- миграции lib/billing/consumption.ts всё ещё имеет fallback на
-- NULL для defense-in-depth (это в отдельном фиксе того же PR).

update package_purchases pp
   set teacher_id = lp.teacher_id
  from lesson_packages lp
 where pp.package_id = lp.id
   and pp.teacher_id is null
   and lp.teacher_id is not null;

-- Reporting query (closed-on-commit для CI):
--   select count(*) as filled from package_purchases
--    where teacher_id is not null;
