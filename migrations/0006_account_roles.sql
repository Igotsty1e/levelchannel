-- Multi-role table so a single account can carry both 'admin' and
-- 'teacher' if the operator wants. CHECK constraint enumerates the
-- allowed values; new roles require a follow-up migration.

create table if not exists account_roles (
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'student')),
  granted_at timestamptz not null default now(),
  granted_by_account_id uuid null references accounts(id) on delete set null,
  primary key (account_id, role)
);

create index if not exists account_roles_role_idx
  on account_roles (role);
