// Combined-version helper for the saas_offer + saas_processor_terms
// two-document bundle.
//
// The cabinet's `account_consents` row for `document_kind='saas_offer'`
// carries a SINGLE row with `document_version` encoded as the literal
// `saas_offer:<offerLabel>+processor_terms:<termsLabel>` string. The
// gate helper (lib/auth/guards.ts) reads this string and parses both
// halves to compare against the live versions.
//
// Round-10 §0af closure: extracted from inline string concat at
// `app/api/auth/register/route.ts:388` for reuse by the
// `/saas-offer-accept` POST handler + the gate-for-mutation helper.
//
// Injectivity: the parser regex is anchored and matches only when the
// versionLabel domain is `[A-Za-z0-9._-]+` (no `:` or `+`). The admin
// publish route at `app/api/admin/legal/versions/route.ts` enforces
// this character set so the parser is unambiguous for all live writes.

/**
 * Build the canonical combinedVersion string for a saas_offer consent
 * row's `document_version` column.
 */
export function buildCombinedVersion(
  saasOfferLabel: string,
  processorTermsLabel: string,
): string {
  return `saas_offer:${saasOfferLabel}+processor_terms:${processorTermsLabel}`
}

const COMBINED_RE = /^saas_offer:([A-Za-z0-9._-]+)\+processor_terms:([A-Za-z0-9._-]+)$/

export type ParsedCombinedVersion = {
  saasOfferLabel: string
  processorTermsLabel: string
}

/**
 * Parse a combinedVersion string. Returns null when the input does not
 * match the canonical shape OR when either embedded label is outside
 * the allowed `[A-Za-z0-9._-]+` character set. Callers MUST treat null
 * as `consent_required` (the row pre-dates this contract OR was
 * written with a malformed label that the admin validator rejected).
 */
export function parseCombinedVersion(
  input: string,
): ParsedCombinedVersion | null {
  const m = COMBINED_RE.exec(input)
  if (!m) return null
  return { saasOfferLabel: m[1], processorTermsLabel: m[2] }
}
