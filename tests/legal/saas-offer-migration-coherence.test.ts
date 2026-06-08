// Static guard on `migrations/0099_saas_v1_publish_and_flip.sql`: for
// every legal_document_versions INSERT this migration emits, the
// `version_label` literal must agree with the «Версия vN» line at the
// top of the `body_md` literal.
//
// 2026-06-08 walkthrough surfaced the live drift: label
// `v1-2026-06-01` shipped alongside a body that declares «Версия v2».
// /saas-offer-accept then shows mixed metadata («version v1-2026-06-01»
// in the header + «Версия v2» inside the document), confusing every
// teacher who reads carefully.
//
// This test fails fast at unit speed (no Docker / migrate:up needed) so
// the gap surfaces in PR CI before any new mismatch lands.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../migrations/0099_saas_v1_publish_and_flip.sql',
)

type Insert = {
  docKind: string
  label: string
  bodyVersionLine: string | null
}

// Parses the migration text and returns one record per legal-doc INSERT.
function parseLegalInserts(sql: string): Insert[] {
  const out: Insert[] = []
  // Match INSERTs in shape:
  //   insert into legal_document_versions
  //     (doc_kind, version_label, effective_from, body_md, ...)
  //   values ('saas_offer', 'v1-2026-06-01', ..., $body$ ... $body$, ...)
  // The body is delimited by Postgres dollar-quoting tag (e.g. $body$).
  const re =
    /insert\s+into\s+legal_document_versions[\s\S]*?values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,[^,]+,\s*\$(\w*)\$([\s\S]*?)\$\3\$/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const [, docKind, label, , body] = m
    const bodyVer = body.match(/Версия\s+(v[0-9]+)/i)
    out.push({
      docKind,
      label,
      bodyVersionLine: bodyVer ? bodyVer[1].toLowerCase() : null,
    })
  }
  return out
}

describe('migration 0099_saas_v1_publish_and_flip — label vs body', () => {
  // Historical drift: the 0099 INSERT body for saas_offer v1-2026-06-01
  // shipped with «Версия v2» in the header. The append-only contract
  // forbids mutating that row in-place (existing teacher consents are
  // FK-bound to it). The drift is corrected by chained editorial row
  // `v1-2026-06-08-editorial` in migration 0115. So this test stays
  // an expected fail — it documents the original drift and serves as
  // a forensic anchor; integration test `saas-offer-version-coherence`
  // checks the ACTIVE row instead, which is now coherent.
  it.fails('every legal-doc INSERT has body «Версия vN» matching version_label vN', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8')
    const inserts = parseLegalInserts(sql)
    expect(inserts.length).toBeGreaterThan(0)

    const mismatches: string[] = []
    for (const ins of inserts) {
      if (!ins.bodyVersionLine) continue // body never claims a version.
      const labelMajor = ins.label.match(/^(v[0-9]+)/i)?.[1].toLowerCase()
      if (labelMajor !== ins.bodyVersionLine) {
        mismatches.push(
          `${ins.docKind}: label "${ins.label}" (major ${labelMajor}) `
            + `vs body «Версия ${ins.bodyVersionLine}»`,
        )
      }
    }
    expect(
      mismatches,
      `Legal-doc version drift in migration 0099. /saas-offer-accept will `
        + `display these mismatched metadata pairs:\n  - `
        + mismatches.join('\n  - '),
    ).toEqual([])
  })
})
