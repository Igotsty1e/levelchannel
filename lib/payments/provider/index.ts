// Wave 41 facade for the former lib/payments/provider.ts. Re-exports
// the public surface 1:1 from the lifecycle + checkout siblings so all
// callers can keep importing @/lib/payments/provider unchanged.

// Types
export type {
  ChargeWithSavedCardOutcome,
  ConfirmThreeDsOutcome,
} from './checkout'

// Values
export {
  markOrderCancelled,
  markOrderFailed,
  markOrderPaid,
  syncMockOrderState,
  toPublicOrder,
} from './lifecycle'

export {
  chargeWithSavedCard,
  confirmThreeDsAndFinalize,
  createPayment,
} from './checkout'
