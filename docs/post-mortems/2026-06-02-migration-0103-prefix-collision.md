# Post-mortem: migration `0103` prefix collision (2026-06-02)

## Summary

Two PRs authored independently against `main` each introduced a new migration with the same `0103` prefix; both PRs merged on the same day without anyone noticing the collision. Result: `main` has two `0103`-prefix migration files:

- `migrations/0103_drop_accounts_postpaid_allowed.sql` (PR #492, merge commit `ee14889`)
- `migrations/0103_teacher_subscription_plans_rename_titles_ru.sql` (PR #490, merge commit `1fd631e`)

Both files already applied to prod (verified via `applied 0103_*` lines in test-integration runner output and prod migration log). DB integrity is intact because the migration runner (`scripts/migrate.mjs`) tracks each migration by full filename, not by numeric prefix.

## Impact

- **No data loss / no schema corruption.** Both migrations applied successfully in alphabetical order on every environment (test, staging, prod). The `_migrations` table holds both rows.
- **Operator confusion only.** Phrases like "migration 0103" no longer uniquely identify a file. Anyone trying to roll back or reference "0103" must specify the full filename.
- **Future risk.** No tooling rejected the collision at PR time. The same incident could recur with any future prefix.

## Timeline (UTC)

- 2026-06-02: PR #490 (`fix(bug-4) Sub-PR A — rename SaaS tiers to Russian`) authored against main, with migration `migrations/0103_teacher_subscription_plans_rename_titles_ru.sql`. Merged to main.
- 2026-06-02: PR #492 (`chore(quality) Sub-PR A — drop accounts.postpaid_allowed sweep`) authored against the same `main` head, with migration `migrations/0103_drop_accounts_postpaid_allowed.sql`. Merged to main, same day.
- 2026-06-02 → 2026-06-05: autodeploy applied both migrations on prod in alphabetical order. No errors. No alerts.
- 2026-06-05: user-prompted backlog cleanup surfaced the collision; remediation work started.

## Root cause

The migration runner tracks by full filename, so it accepts any number of files sharing a numeric prefix. There was no CI gate rejecting prefix collisions. Two PRs branched off the same `main` head, each picked `0103` as the next available prefix, and the parallel merge timeline meant neither PR saw the other's migration when it landed.

## Remediation

### Reactive (no DB change)

The two `0103` files are KEPT as-is on main:
- Renaming them would require destructive `UPDATE _migrations SET name = ...` on every environment AND a coordinated re-deploy. The operator risk outweighs the cosmetic benefit.
- The DB state is already correct on every environment.
- Documentation references (`docs/plans/`, commit history) link by full filename, not by prefix.

### Preventive (this PR)

- `scripts/check-migration-prefixes.mjs` — scans `migrations/*.sql`, fails if any prefix appears more than once. `0103` is grandfathered via the `ALLOWED_HISTORICAL_COLLISIONS` set; ALL future prefix collisions block CI.
- `.github/workflows/product-flow-evals.yml` — new `migration-prefixes` job runs the check on every PR + every push to main. Job runs in <5 seconds.
- `npm run check:migration-prefixes` — local-dev alias.

### Convention adjustment

The check supports an optional single-letter suffix (`NNNN[a-z]?_*`) for intentional sub-numbering within the same slot (precedent: `0076a_lesson_packages_teacher_id.sql` + `0076c_package_purchases_teacher_id.sql`). Letter-suffixed migrations are treated as DISTINCT prefixes for collision detection — this matches the operator's deliberate disambiguation.

## Lessons

1. **Filename-based migration tracking is too forgiving.** A NNNN-prefix collision should fail at PR time, not after both merges land.
2. **Parallel PR landings need a coordination check.** The 2026-06-02 incident is the kind of race that CI gates are designed to catch — but only if the gate exists.
3. **Grandfathered exceptions need explicit allowlists.** The `0103` files stay, but the allowlist makes it visible to anyone touching the check what's permitted vs. what's a real bug.
