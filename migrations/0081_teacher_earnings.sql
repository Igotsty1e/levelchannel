-- SAAS-PIVOT Epic 1 Day 1 — teacher_earnings append-only ledger +
-- teacher_earnings_payout_coverage M:N table.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0081`, §2.7 ledger
-- shape, §5 Day 1 step 8.
--
-- Append-only ledger. Three row kinds (sign-invariant CHECK):
--   - accrued    — positive amount_net (learner paid; teacher's share).
--   - paid_out   — negative amount_net (operator paid the teacher).
--   - clawback   — negative amount_net (refund of an accrued row).
--
-- Refund handler ALWAYS inserts a new `kind='clawback'` row, never
-- UPDATEs the original `accrued`. Balance = SUM(amount_net) GROUP BY
-- teacher_account_id; can go negative if operator overpaid.
--
-- ROUND-25 BLOCKER #1 CLOSURE — Day-1 limitations on FKs:
--   - `refund_reversal_id` references payment_allocation_reversals(id)
--     (mig 0036), NOT a non-existent `refund_records` table. Round-25
--     closure confirms `refund_records` does not exist in this repo.
--   - `related_completion_id` is a plain UUID on Day 1 — the
--     `lesson_completions(id)` target doesn't exist yet (mig 0079 lands
--     on Day 5A). Mig 0079 will add the FK via
--     `alter table teacher_earnings add constraint teacher_earnings_completion_fk
--       foreign key (related_completion_id) references lesson_completions(id)`.
--   - `related_accrued_id` self-references teacher_earnings(id) for the
--     accrued ↔ clawback linkage — supports partial-refund accounting
--     (round-22 BLOCKER #2 closure: the eligible-for-payout query reads
--     `coalesce(sum(c.amount_net),0)` across all clawbacks for an accrued,
--     not "any clawback → exclude").
--
-- `payment_order_id` FK → payment_orders.invoice_id (text, not uuid).
-- Set on accrued + clawback rows. NULL on paid_out (operator → teacher
-- transfer is out-of-platform money; no payment_orders row).
--
-- Initialised empty on Day 1. Populated by the Plan-4 webhook handler
-- (Epic 5/6). Bootstrap teacher's plan-4 subscription begins from mig 0083
-- step 4 but no historical earnings backfill (operator did not previously
-- track teacher splits).

create table if not exists teacher_earnings (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null
    references accounts(id) on delete restrict,
  kind text not null check (kind in ('accrued', 'paid_out', 'clawback')),
  amount_net numeric(10, 2) not null,
  payment_order_id text null
    references payment_orders(invoice_id) on delete restrict,
  refund_reversal_id uuid null
    references payment_allocation_reversals(id) on delete restrict,
  -- Plain UUID on Day 1. FK to lesson_completions(id) added by mig 0079
  -- (Day 5A) when the target table exists.
  related_completion_id uuid null,
  related_accrued_id uuid null
    references teacher_earnings(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint teacher_earnings_sign_invariant
    check (
      (kind = 'accrued' and amount_net > 0)
      or (kind in ('paid_out', 'clawback') and amount_net < 0)
    )
);

-- Balance / history reads — hot path for `/admin/teachers/[id]` ledger UI.
create index if not exists teacher_earnings_balance_idx
  on teacher_earnings (teacher_account_id, created_at desc);

-- Eligible-for-payout selector (§2.7 canonical query).
create index if not exists teacher_earnings_accrued_idx
  on teacher_earnings (teacher_account_id)
  where kind = 'accrued';

-- Clawback ↔ accrued joinback (partial-refund query).
create index if not exists teacher_earnings_clawback_accrued_idx
  on teacher_earnings (related_accrued_id)
  where kind = 'clawback' and related_accrued_id is not null;

comment on table teacher_earnings is
  'SAAS-PIVOT Epic 1 (2026-05-22): append-only earnings ledger. '
  'Sign-invariant CHECK. Refund handler INSERTs clawback rows (never UPDATEs). '
  'Plan: docs/plans/saas-pivot-master.md §2.7.';
comment on column teacher_earnings.related_completion_id is
  'Plain UUID on Day 1. Mig 0079 (Day 5A) adds the FK to lesson_completions(id).';

-- Payout-coverage M:N: one paid_out row aggregates N accrued rows.
create table if not exists teacher_earnings_payout_coverage (
  payout_id uuid not null
    references teacher_earnings(id) on delete cascade,
  accrued_id uuid not null
    references teacher_earnings(id) on delete cascade,
  primary key (payout_id, accrued_id)
);

create index if not exists teacher_earnings_payout_coverage_accrued_idx
  on teacher_earnings_payout_coverage (accrued_id);

comment on table teacher_earnings_payout_coverage is
  'SAAS-PIVOT Epic 1 (2026-05-22): M:N pairing between paid_out rows and '
  'the accrued rows they cover. Operator payout batch writes 1 paid_out '
  'row + N coverage rows in a single TX. Plan: §2.7.';
