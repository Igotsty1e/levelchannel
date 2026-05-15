// Wave 42 facade for the former lib/billing/packages.ts. Re-exports
// the public surface 1:1 from catalog / purchases / debt so all
// callers can keep importing @/lib/billing/packages unchanged.

// Types
export type { LessonPackage } from './catalog'
export type { PackagePurchase } from './purchases'
export type { PostpaidDebtSlot } from './debt'

// Values
export {
  createPackage,
  getPackageBySlug,
  listActivePackages,
  listActivePackagesByDuration,
  updatePackageMetadata,
} from './catalog'

export {
  accountHasPendingPackageGrantForDuration,
  createPackagePurchase,
  listAccountActivePackages,
  listPackagePurchasesByIds,
} from './purchases'

export { listAccountPostpaidDebt } from './debt'
