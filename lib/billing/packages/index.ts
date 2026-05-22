// Wave 42 facade for the former lib/billing/packages.ts. Re-exports
// the public surface 1:1 from catalog / purchases / debt so all
// callers can keep importing @/lib/billing/packages unchanged.

// Types
export type { LessonPackage } from './catalog'
export type { PackagePurchase } from './purchases'
export type { PostpaidDebtSlot, AccountPostpaidDebtSummary } from './debt'

// Values
export {
  countPackagesBySlug,
  createPackage,
  ensureBootstrapTeacherAccount,
  getBootstrapTeacherAccountId,
  getPackageById,
  getPackageBySlug,
  getPackageBySlugForTeacher,
  listActivePackages,
  listActivePackagesByDuration,
  listPackagesByTeacher,
  updatePackageMetadata,
} from './catalog'

export {
  accountHasPendingPackageGrantForDuration,
  createPackagePurchase,
  listAccountActivePackages,
  listPackagePurchasesByIds,
} from './purchases'

export {
  listAccountPostpaidDebt,
  listAccountsWithPostpaidDebtAggregate,
} from './debt'

// API-BOUNDARIES (2026-05-18) — facade exports for eligibility so
// outside callers don't import @/lib/billing/packages/eligibility
// directly.
export type { ActiveOwnedPackage } from './eligibility'
export { learnerHasActivePackageOfDuration } from './eligibility'
