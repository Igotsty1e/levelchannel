-- PKG-RECON wave RECON.0 — durable operator resolution log for
-- paid_not_granted orders.
--
-- Context: when CloudPayments fires `pay.processed` on a package
-- order and lib/billing/package-grant.ts:processPackageGrant hits any
-- of the 7 enumerated semantic failures, the audit row is the only
-- breadcrumb today. Operator has NO UI to retry / attach / mark-
-- resolved; lib/billing/deletion-guard.ts:Branch B blocks account
-- deletion indefinitely.
--
-- This table is the durable counterpart of the operator resolution
-- decision. NOT subject to the 3-year payment_audit_events retention
-- (the audit table is rotated by db-retention-cleanup; this table is
-- not). One row per resolved invoice — terminal by design:
-- ON CONFLICT (invoice_id) DO NOTHING at insert time.
--
-- deletion-guard.ts:checkAccountInFlightPackageGrant Branch B is
-- extended in this wave to also check NOT EXISTS in this table —
-- so an operator-marked resolution actually UNBLOCKS account
-- deletion (round 2 BLOCKER #2 closure).

create table if not exists package_grant_resolutions (
  invoice_id text primary key
    references payment_orders(invoice_id) on delete restrict,
  resolved_by_account_id uuid not null
    references accounts(id) on delete restrict,
  -- Three resolution kinds, mirroring the three operator actions
  -- shipped in this epic:
  --   granted                — admin retry-grant succeeded
  --   attached_and_granted   — admin attach-account + grant succeeded
  --   marked_resolved_manually — operator decided no grant is needed
  --                              (refunded out-of-band, comped, etc.)
  resolution text not null
    check (resolution in (
      'granted',
      'attached_and_granted',
      'marked_resolved_manually'
    )),
  -- Only meaningful when resolution = marked_resolved_manually. Tags
  -- the why for later audit + reconciliation against the operator's
  -- out-of-band actions.
  category text null
    check (category is null or category in (
      'manual_grant_via_tariff',
      'refunded_offline',
      'comped',
      'other'
    )),
  -- Required, non-empty. Auto-generated for retry-grant /
  -- attach-account paths (server-side default); operator-supplied
  -- for marked_resolved_manually.
  reason text not null
    check (char_length(reason) between 1 and 1024),
  -- Action-specific structured context:
  --   granted               → { packagePurchaseId }
  --   attached_and_granted  → { previousAccountId, previousCustomerEmail,
  --                             newAccountId, newCustomerEmail,
  --                             packagePurchaseId }
  --   marked_resolved_manually → { cpRefundTransactionId? }
  payload jsonb not null default '{}'::jsonb,
  resolved_at timestamptz not null default now()
);

create index if not exists package_grant_resolutions_resolved_at_idx
  on package_grant_resolutions (resolved_at desc);

comment on table package_grant_resolutions is
  'PKG-RECON: durable operator resolution log for paid_not_granted '
  'orders. deletion-guard.ts Branch B reads this table to unblock '
  'account deletion after operator resolution. Terminal: one row '
  'per invoice; ON CONFLICT DO NOTHING.';
