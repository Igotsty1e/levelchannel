-- mig 0140 — Epic C follow-up: pre-seed teacher_note на этапе приглашения
-- (2026-06-19).
--
-- Owner-task §2 второй пункт: при отправке приглашения учитель может
-- сразу написать комментарий о ученике; при redeem заметка скопируется в
-- learner_teacher_links.teacher_note. До этой миграции карточка-заметка
-- в профиле ученика доступна только после redeem (см. mig 0137).
--
-- Контракт:
--   - teacher_note_seed text NULL — что учитель указал при создании
--     приглашения.
--   - CHECK char_length(teacher_note_seed) <= 2000 — зеркало lim'а из
--     learner_teacher_links (mig 0137).
--   - Если в момент redeem уже есть teacher_note (например, учитель
--     успел написать вручную), seed НЕ перетирает существующую заметку.
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS + DO-block для CHECK.

alter table teacher_invites
  add column if not exists teacher_note_seed text null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'teacher_invites_teacher_note_seed_len_chk'
  ) then
    alter table teacher_invites
      add constraint teacher_invites_teacher_note_seed_len_chk
      check (teacher_note_seed is null or char_length(teacher_note_seed) <= 2000);
  end if;
end
$migration$;

comment on column teacher_invites.teacher_note_seed is
  'Pre-seed заметки учителя о приглашаемом ученике. Копируется в '
  'learner_teacher_links.teacher_note при redeem. NULL = нет seed. '
  'Если у пары (teacher, learner) уже есть teacher_note, seed НЕ перетирает '
  '(защита от случайного затирания при повторных приглашениях).';
