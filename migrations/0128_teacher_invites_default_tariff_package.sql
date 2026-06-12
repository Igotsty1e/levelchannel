-- 0128_teacher_invites_default_tariff_package.sql
-- teacher-invite-tariffs-packages-collapse epic (2026-06-12).
--
-- Owner ask: учитель при создании инвайт-ссылки должен сразу выбирать
-- какие тарифы и пакеты получит приглашённый ученик после регистрации.
-- На сегодня инвайт несёт только default_payment_method (mig 0101).
--
-- Колонки UUID[] вместо junction-table per-invite: invite — short-lived
-- (7 дней) snapshot intent; junction добавит 2 индекса + триггер cascade
-- ради ~5 строк rare reads. Массивы дёшевы + array_length CHECK
-- cap'нет abuse (макс 20 id каждого типа).
--
-- Ownership of submitted ids re-validated at INSERT/redeem time в
-- TS (lib/auth/teacher-invites.ts) — DB-level FK невозможна, потому
-- что arrays.

alter table teacher_invites
  add column if not exists default_tariff_ids uuid[] not null default '{}'::uuid[],
  add column if not exists default_package_ids uuid[] not null default '{}'::uuid[];

alter table teacher_invites
  add constraint teacher_invites_default_tariff_ids_cap
    check (array_length(default_tariff_ids, 1) is null or array_length(default_tariff_ids, 1) <= 20),
  add constraint teacher_invites_default_package_ids_cap
    check (array_length(default_package_ids, 1) is null or array_length(default_package_ids, 1) <= 20);
