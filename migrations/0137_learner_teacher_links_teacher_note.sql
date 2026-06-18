-- mig 0137 — Epic C: учительская заметка о ученике (2026-06-18).
--
-- Owner-backlog 2026-06-18: учитель пишет приватную заметку (до 2000
-- символов) на каждого ученика. Заметка per-teacher: один и тот же
-- ученик у двух учителей видит две независимые заметки. Хранение —
-- расширение n:m таблицы learner_teacher_links (mig 0077).
--
-- Plan: docs/plans/clever-sprouting-floyd.md Epic C.
--
-- Storage:
--   teacher_note  text NULL  -- NULL = нет заметки. Empty string не
--                            -- хранится: API нормализует '' → NULL.
--   CHECK char_length(teacher_note) <= 2000  -- soft cap, hard-enforced
--
-- Idempotent — повторное применение skip'нется через "if not exists".

alter table learner_teacher_links
  add column if not exists teacher_note text null;

-- CHECK constraint отдельным DO-blocком чтобы pg_catalog проверял
-- наличие до создания (`add constraint if not exists` появится только
-- в Postgres 18+).
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'learner_teacher_links_teacher_note_len_chk'
  ) then
    alter table learner_teacher_links
      add constraint learner_teacher_links_teacher_note_len_chk
      check (teacher_note is null or char_length(teacher_note) <= 2000);
  end if;
end
$migration$;

comment on column learner_teacher_links.teacher_note is
  'Приватная учительская заметка про ученика. Per-teacher: видна только этому учителю. До 2000 символов. NULL = нет заметки. Запрещён пустой '''
  ' string (API кладёт NULL).';
