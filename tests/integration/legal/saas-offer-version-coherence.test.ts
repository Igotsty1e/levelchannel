// Sanity check on legal_document_versions: the `version_label` column
// MUST agree with the «Версия vN» line inside `body_md`. A mismatch
// (e.g. label «v1-2026-06-01» but body says «Версия v2») is what users
// see in /saas-offer-accept and means consent rows reference one
// version while the displayed document describes another — a legal
// liability we want surfaced before any deploy.
//
// The 2026-06-08 walkthrough found exactly this drift in the live
// v1-2026-06-01 row. Migrations re-seed it on integration test bring-up,
// so this test reads what `npm run migrate:up` produced, not the dev
// database.

import { describe, expect, it } from 'vitest'

import { getAuthPool } from '@/lib/auth/pool'
import type { LegalDocKind } from '@/lib/legal/versions'

import '../setup'

// Capture matches:
//   "Версия v1.   Дата редакции: ..."        → ["v1"]
//   "Версия v2."                             → ["v2"]
//   "Версия v0-placeholder-do-not-accept"    → ["v0"]
const BODY_VERSION_REGEX = /Версия\s+(v[0-9]+)/i

function extractBodyMajor(body: string): string | null {
  const m = body.match(BODY_VERSION_REGEX)
  return m ? m[1].toLowerCase() : null
}

function extractLabelMajor(label: string): string | null {
  const m = label.match(/^(v[0-9]+)/i)
  return m ? m[1].toLowerCase() : null
}

const KINDS: LegalDocKind[] = [
  'offer',
  'privacy',
  'personal_data',
  'saas_offer',
  'saas_processor_terms',
]

describe('legal_document_versions — label/body version coherence', () => {
  // We assert coherence only on the ACTIVE row (greatest effective_from
  // ≤ now()). Historical rows are append-only and may carry drift
  // that has since been chained over by an editorial successor; that
  // is fine — existing consent-rows are bound to those historical
  // bodies by FK and must NOT be retouched.
  it.each(KINDS)(
    '%s: active row has label major === body «Версия vN»',
    async (kind) => {
      const pool = getAuthPool()
      const r = await pool.query<{ version_label: string; body_md: string }>(
        `select version_label, body_md
           from legal_document_versions
          where doc_kind = $1
            and effective_from <= now()
          order by effective_from desc, created_at desc
          limit 1`,
        [kind],
      )
      if (r.rows.length === 0) return // fresh test DB w/o seed for this kind.
      const row = r.rows[0]
      const bodyMajor = extractBodyMajor(row.body_md)
      if (!bodyMajor) return // body never claims a version — fine.
      const labelMajor = extractLabelMajor(row.version_label)
      expect(
        labelMajor,
        `${kind}: active row "${row.version_label}" has a body that says ` +
          `«Версия ${bodyMajor}»; label major must match. ` +
          `If body drifted, chain an editorial successor row (mig pattern: 0115).`,
      ).toBe(bodyMajor)
    },
  )
})
