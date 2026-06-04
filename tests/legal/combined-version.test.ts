// Unit tests for lib/legal/combined-version.ts — round-trip (build →
// parse) over the allowed versionLabel character set + rejection of
// strings that don't match the canonical shape OR carry separator chars
// outside the allow-list `[A-Za-z0-9._-]+`.

import { describe, it, expect } from 'vitest'

import {
  buildCombinedVersion,
  parseCombinedVersion,
} from '@/lib/legal/combined-version'

describe('combined-version helper', () => {
  it('round-trips canonical v1/v1 shape', () => {
    const s = buildCombinedVersion('v1', 'v1')
    expect(s).toBe('saas_offer:v1+processor_terms:v1')
    const parsed = parseCombinedVersion(s)
    expect(parsed).toEqual({ saasOfferLabel: 'v1', processorTermsLabel: 'v1' })
  })

  it('round-trips labels with hyphens, dots, and digits', () => {
    const s = buildCombinedVersion('v1.2', '2026-05-30')
    expect(parseCombinedVersion(s)).toEqual({
      saasOfferLabel: 'v1.2',
      processorTermsLabel: '2026-05-30',
    })
  })

  it('round-trips labels with underscores', () => {
    const s = buildCombinedVersion('v1_rc1', 'v2_final')
    expect(parseCombinedVersion(s)).toEqual({
      saasOfferLabel: 'v1_rc1',
      processorTermsLabel: 'v2_final',
    })
  })

  it('returns null on missing saas_offer prefix', () => {
    expect(parseCombinedVersion('v1+processor_terms:v1')).toBeNull()
  })

  it('returns null on missing processor_terms section', () => {
    expect(parseCombinedVersion('saas_offer:v1')).toBeNull()
  })

  it('returns null when labels contain a colon (ambiguous parse)', () => {
    // Injectivity check — admin validator rejects ':' in labels.
    expect(parseCombinedVersion('saas_offer:v1:evil+processor_terms:v1')).toBeNull()
  })

  it('returns null when labels contain a plus sign (ambiguous parse)', () => {
    expect(parseCombinedVersion('saas_offer:v1+evil+processor_terms:v1')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(parseCombinedVersion('')).toBeNull()
  })

  it('returns null on plain unrelated string', () => {
    expect(parseCombinedVersion('hello world')).toBeNull()
  })

  it('returns null on legacy v1-only document_version value', () => {
    // Pre-§0af consent rows carried a bare 'v1' string. The gate
    // treats null-parse as `consent_required` so legacy cohorts get
    // routed through the accept flow instead of silently passing.
    expect(parseCombinedVersion('v1')).toBeNull()
  })
})
