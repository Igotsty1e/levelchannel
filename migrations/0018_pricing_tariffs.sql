-- Phase 3 — operator-managed price catalog.
--
-- Phase 3 ships only the table + admin CRUD. The public /pay flow
-- stays free-amount in this wave; wiring /pay to the catalog (with a
-- free-amount fallback for one-off operator-DM payments) ships with
-- the cabinet payment surface in Phase 6 (see ENGINEERING_BACKLOG.md).
--
-- Money is stored in kopecks (integer). Rubles are a derived display
-- value — never round-trip rubles → kopecks → rubles in the price
-- path; that's where 0.01₽ drift bugs come from. The check constraint
-- enforces a sensible band (≥1₽, ≤1 000 000₽) so accidental decimal-
-- shift typos in /admin can't ship a tariff that pays out 100x.
--
-- `is_active = false` is a soft archive: the row stays for history /
-- referential integrity from `payment_orders` once Phase 6 wires
-- order.tariff_id, but it stops appearing in learner-facing lists.
--
-- `display_order` is an editorial sort hint (smaller = earlier).
-- `slug` is operator-shorthand (`lesson-60min`, `package-10`); the
-- slug regex disallows whitespace and capitals to keep URLs stable
-- if a future surface uses /pricing/<slug>.

create table if not exists pricing_tariffs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title_ru text not null,
  description_ru text null,
  amount_kopecks integer not null,
  currency text not null default 'RUB',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_tariffs_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'),
  constraint pricing_tariffs_title_len
    check (char_length(title_ru) between 1 and 120),
  constraint pricing_tariffs_amount_band
    check (amount_kopecks between 100 and 100000000),
  constraint pricing_tariffs_currency_allowlist
    check (currency in ('RUB'))
);

create unique index if not exists pricing_tariffs_slug_unique
  on pricing_tariffs (slug);

create index if not exists pricing_tariffs_active_order_idx
  on pricing_tariffs (display_order, id) where is_active = true;
