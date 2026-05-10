// Convert payment_orders.amount_rub (numeric, e.g. 2500.00) to the
// integer kopecks the audit / allocations / package_purchases tables
// store. Rounding instead of floor() because the order amount comes
// from the API as a Number — IEEE 754 drift on values like
// 2500.0000000001 should not turn into 249999.
export function rublesToKopecks(amountRub: number): number {
  return Math.round(amountRub * 100)
}
