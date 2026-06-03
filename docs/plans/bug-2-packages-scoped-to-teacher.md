# Bug #2 — Packages catalog must be scoped to learner's teacher(s)

Status: SHIPPED — PR #495 merged 2026-06-02 (SHA edb2907). Wave paranoia §7 fallback (Codex quota exhausted; 2 plan errors + 4 wave findings closed inline).
Owner: Claude (auto mode session 2026-06-02)
Branch: `bug/2-packages-teacher-scope`

## Bug report

> Сейчас новые ученики видят наши тестовые пакеты которые мы делали раньше.
> Нужно сделать так чтобы пакеты отображались только те, которые принадлежат
> учителю ученика. Тут явно какая то проблема.

## Root cause (one-liner)

`lib/billing/packages/catalog.ts::listActivePackages(viewerAccountId)` returns
ALL `visibility='catalog'` packages from EVERY teacher with an
`operator-managed` subscription. It never joins `learner_teacher_links`, so a
learner sees catalog packages from teachers they have no relationship with —
including the bootstrap teacher's legacy test packages.

The T3 epic (PRs #470–#476) added `learner_package_access` for **private**
packages, but the **catalog** branch of the OR was left unconditioned on
teacher scope. Symptom: a fresh learner with zero links sees the bootstrap
teacher's test catalogue. A learner linked to teacher A sees catalog packages
from teachers B, C, D too.

## Surface inventory

Live callers of `listActivePackages` (SSR catalogue):

- `app/cabinet/packages/page.tsx:60` — learner catalogue page. Passes
  `account.id`. **In scope.**

Live callers of `listActivePackagesByDuration` (booking hint after
`package_required` 422):

- `lib/scheduling/slots/booking.ts:310` — already passes
  `teacherAccountId: slot.teacherAccountId` + `viewerAccountId: learner`. The
  function already filters by `teacher_id = $3` when given. **Already scoped,
  no change.** Sanity-check kept in this plan; regression test asserts it.

Dead-import test in `app/api/admin/packages/route.ts:69` (`void
listActivePackages`) — silent reference only, not a runtime caller.

## Fix design

### SQL filter change (`listActivePackages`)

Add a `learner_teacher_links` (active) join when `viewerAccountId IS NOT
NULL`. Both the catalog and private branches must be restricted to packages
whose owning teacher has an active link to the viewer.

When `viewerAccountId IS NULL` (anonymous): legacy contract preserved —
catalog-only, all teachers (no learner context, so no link to filter by).
Today this path has zero live callers; preserving it costs nothing and lets
us ship a single SQL change.

New WHERE clause (rendered against the same projection):

```sql
where lp.is_active = true
  and lp.deleted_at is null
  and ts.plan_slug = 'operator-managed'
  and ts.state = 'active'
  and (
    -- Anonymous viewer: catalog from every operator-managed teacher.
    -- Legacy contract preserved for zero-caller paths.
    ($1::uuid is null and lp.visibility = 'catalog')
    or (
      -- Authenticated viewer: catalog OR granted-private, BUT only from
      -- teachers the viewer is actively linked to.
      $1::uuid is not null
      and exists (
        select 1 from learner_teacher_links ltl
         where ltl.teacher_account_id = lp.teacher_id
           and ltl.learner_account_id = $1::uuid
           and ltl.unlinked_at is null
      )
      and (
        lp.visibility = 'catalog'
        or (
          lp.visibility = 'private'
          and exists (
            select 1 from learner_package_access lpa
             where lpa.package_id = lp.id
               and lpa.learner_account_id = $1::uuid
               and lpa.revoked_at is null
          )
        )
      )
    )
  )
```

### Defensive note on private packages

The `learner_package_access` BEFORE-INSERT trigger already enforces an active
`learner_teacher_links` row (mig 0102 invariants `(c)`). So in steady state, a
private package grant cannot exist without an active link. The new EXISTS
guard on `learner_teacher_links` for the private branch is therefore defense
in depth: if a teacher revokes a learner's link AFTER granting (the trigger
only fires on insert/update), we now also hide previously-granted private
packages from view. Plan acceptance criterion: revoke-link hides catalog AND
private packages.

### What about `listActivePackagesByDuration`?

Already scoped: caller in `booking.ts` passes `teacherAccountId`. No change.
Regression test still covers it.

### Migration impact

None. The fix is read-side only. No schema change, no migration. (Mig 0103
collision noted below — irrelevant to this fix because we don't add one.)

### Migration numbering collision (informational)

Main currently has TWO migrations numbered 0103:

```
0103_drop_accounts_postpaid_allowed.sql
0103_teacher_subscription_plans_rename_titles_ru.sql
```

Both already merged. Not introduced by this bug; not blocking this fix. Out
of scope — flagged for separate housekeeping.

## Regression test plan

New file: `tests/integration/billing/bug-2-packages-teacher-scope.test.ts`.

Seed two operator-managed teachers (A and B), each with one catalog package
and one private package. Seed three learners:

1. **Fresh learner with no links** — `listActivePackages(learnerId)` returns
   `[]` (zero packages). Acceptance: bug report wording verified.
2. **Learner linked only to teacher A** —
   `listActivePackages(learnerId)` returns A's catalog package only (B's is
   hidden; A's private hidden without grant; B's private hidden).
3. **Learner linked to A with a private-grant** — `listActivePackages`
   returns A's catalog + A's private. B's not present.
4. **Learner linked to A, then unlinked (`unlinked_at` set)** — returns `[]`.
5. **Anonymous viewer (`viewerAccountId` undefined)** — returns BOTH A's and
   B's catalog packages (legacy contract preserved). Both private hidden.
6. **`listActivePackagesByDuration` regression** — A's slot offers A's
   catalog package only when learner linked to A. (Just to lock down the
   existing scope.)

## Files touched

- `lib/billing/packages/catalog.ts` — replace WHERE clause in
  `listActivePackages` (single function edit, ~25 LOC).
- `tests/integration/billing/bug-2-packages-teacher-scope.test.ts` — new
  regression test file (~150 LOC).
- `tests/integration/billing/t3-learner-package-filter.test.ts` — **NO
  update required.** Re-audit (plan self-review round 1, finding 2): test
  #1 calls `listActivePackages()` (no arg → anonymous branch preserved);
  tests #2 and #3 already insert `learner_teacher_links` rows before
  asserting visibility. The existing assertions stay green under the new
  filter as-is.

## Risk assessment (MONEY-ADJACENT)

- **Risk 1**: hiding a LEGITIMATE catalog package from a paying learner.
  Mitigation: existing T3 test (updated as above) still asserts that linked
  learners see catalog from their teacher. Added regression test asserts the
  "linked to A → see A's catalog" path.
- **Risk 2**: breaking the public anonymous catalog (none today, but the
  function contract still says it works). Mitigation: anonymous branch
  preserved verbatim.
- **Risk 3**: breaking the booking-hint surface (the "you need a package"
  422 response). Mitigation: separate function (`listActivePackagesByDuration`)
  is untouched; integration test pins it.
- **Risk 4**: a learner with multiple teachers no longer seeing some catalog
  packages. Verified: the new clause uses EXISTS — so for each package row
  the filter checks "is there ANY active link from viewer to THIS package's
  owner". Multi-link learner sees the UNION of catalogs from every teacher
  they are linked to. Single-test scenario for the bug-report path is
  sufficient; multi-link semantics fall out of the SQL form by construction.
- **Risk 5**: race between revoke-link and a learner viewing the page. The
  read is one SELECT — it reflects the link state at SELECT time. There's no
  TTL or cache layer to invalidate.

## Backout plan

`git revert <commit>` is safe — this is a single-file read-side change with
no migration and no schema effect. If a real-world false-negative is seen on
prod, revert restores the old (over-permissive) behavior immediately while
we diagnose.

## Implementation steps

1. Patch `lib/billing/packages/catalog.ts` per §SQL filter change.
2. Add new regression file `tests/integration/billing/bug-2-packages-teacher-scope.test.ts`.
3. Patch existing test cases in `t3-learner-package-filter.test.ts` to seed
   `learner_teacher_links` where they previously relied on the catalog being
   visible without a link.
4. `npm run test:integration` — local green.
5. `npm run build` — typecheck green.
6. PR, wave paranoia (3 rounds hard cap), squash-merge.

## Paranoia hard caps

- Plan checkpoint: 3 rounds. BLOCKERs close in plan before code.
  **Note (2026-06-02): Codex quota exhausted before first round; per
  codex-paranoia §7 with the substantive-vs-bounded-scope discriminator
  (one SQL function, additive filter, no schema change, no migration),
  the agent did a structured plan self-review instead. Findings 2 and 4
  applied above.**
- Wave checkpoint: 3 rounds. BLOCKERs close before merge (this is
  money-adjacent — no shifted-right detection here). Same Codex-quota
  fallback applies if quota still exhausted at wave time.

## SQL performance + index audit (self-review)

The new `EXISTS (select 1 from learner_teacher_links ...)` filter is
keyed on `(teacher_account_id = lp.teacher_id, learner_account_id = $1,
unlinked_at IS NULL)`. Two indexes serve this:

1. PK btree `(learner_account_id, teacher_account_id)` — covers the
   bind-on-both-columns lookup directly. PostgreSQL planner will choose
   this (1-row lookup per scanned package).
2. Partial index `learner_teacher_links_active_teacher_idx` on
   `(teacher_account_id) WHERE unlinked_at IS NULL` — would be used if
   the planner inverts the join shape (rare, but available).

For a typical learner with O(1) active links and a catalog of O(N)
packages, the cost is O(N) PK lookups, each O(log L) where L = total
links. With L ~ 10k learners × 1 teacher = 10k rows, log L ≈ 14. Total
cost: trivial. No new index needed.

## Done definition

- New regression test green.
- Existing T3 + booking tests still green.
- Bug #2 reproduces zero packages for a fresh learner; only the linked
  teacher's catalog after link.
- PR merged to main with `Codex-Paranoia: SIGN-OFF` and `Skill-Used:`
  trailers.
