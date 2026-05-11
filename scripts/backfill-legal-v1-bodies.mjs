#!/usr/bin/env node
//
// Wave 48 — backfill v1 markdown bodies in legal_document_versions.
//
// Why this script exists (operator runs ONCE per env, after deploy):
//
//   The Wave 19 migration 0032 seeded v1 rows for offer / privacy /
//   personal_data with a placeholder body ("См. /offer текущая версия на
//   момент эффективной даты"). That was fine for a launch when the JSX
//   pages and the v1 snapshot matched 1:1 — readers of /legal/v/v1-id
//   could follow the link. But once v2 is published, /offer diverges
//   from what v1-era consenters actually agreed to, and the placeholder
//   loses its anchor.
//
//   This script captures a faithful markdown snapshot of v1 BEFORE that
//   divergence. The templates in scripts/legal-v1-templates/ are the
//   editorial source-of-truth. This script materializes the operator
//   env-var placeholders ({{LEGAL_OPERATOR_OGRN}}, etc.) using the
//   process env where the script runs.
//
//   Per-env materialization is intentional. On CI/dev the env-vars are
//   placeholder strings; the resulting v1 row in those DBs is also
//   placeholder. On prod the operator runs the script with the real
//   env-vars set in /etc/levelchannel/env, producing the real snapshot.
//   Only prod's v1 row carries legal weight.
//
// Idempotent: re-running on the same env overwrites the v1 body with
// the same materialized text. Safe to run repeatedly. UPDATEs only
// v1 rows; never touches v2+.
//
// Usage:
//
//   node scripts/backfill-legal-v1-bodies.mjs
//
// Required env: DATABASE_URL (or AUTH_DATABASE_URL) + every
// NEXT_PUBLIC_LEGAL_* and NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL that the
// templates reference. Missing env-vars cause the script to abort
// without writing anything — better a clean error than a half-
// materialized snapshot.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEMPLATES = [
  { docKind: 'offer', file: 'offer.md' },
  { docKind: 'privacy', file: 'privacy.md' },
  { docKind: 'personal_data', file: 'personal-data.md' },
]

// Mapping markdown token → env-var name. Every token used in any
// template must appear here.
const TOKEN_TO_ENV = {
  LEGAL_OPERATOR_DISPLAY: 'NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY',
  LEGAL_OPERATOR_TAX_ID: 'NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID',
  LEGAL_OPERATOR_OGRN: 'NEXT_PUBLIC_LEGAL_OPERATOR_OGRN',
  LEGAL_OPERATOR_REG_AUTHORITY: 'NEXT_PUBLIC_LEGAL_OPERATOR_REG_AUTHORITY',
  LEGAL_OPERATOR_CLAIMS_ADDRESS: 'NEXT_PUBLIC_LEGAL_OPERATOR_CLAIMS_ADDRESS',
  PUBLIC_CONTACT_EMAIL: 'NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL',
  LEGAL_BANK_ACCOUNT: 'NEXT_PUBLIC_LEGAL_BANK_ACCOUNT',
  LEGAL_BANK_NAME: 'NEXT_PUBLIC_LEGAL_BANK_NAME',
  LEGAL_BANK_BIK: 'NEXT_PUBLIC_LEGAL_BANK_BIK',
  LEGAL_BANK_CORR_ACCOUNT: 'NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT',
  LEGAL_BANK_CITY: 'NEXT_PUBLIC_LEGAL_BANK_CITY',
}

function resolveTokens(template) {
  const seen = new Set()
  const missing = new Set()
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, token) => {
    seen.add(token)
    const envName = TOKEN_TO_ENV[token]
    if (!envName) {
      missing.add(`(unknown token) ${token}`)
      return `{{${token}}}`
    }
    const value = process.env[envName]
    if (!value || !value.trim()) {
      missing.add(`${envName} (template token {{${token}}})`)
      return `{{${token}}}`
    }
    return value
  })
  return { resolved: out, seen: [...seen], missing: [...missing] }
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.AUTH_DATABASE_URL
  if (!url) {
    console.error(
      'DATABASE_URL (or AUTH_DATABASE_URL) is required.\n' +
        'Aborting: refuse to run without a target DB.',
    )
    process.exit(1)
  }

  const allMissing = new Set()
  const materialized = []
  for (const { docKind, file } of TEMPLATES) {
    const filePath = path.join(__dirname, 'legal-v1-templates', file)
    const template = await readFile(filePath, 'utf-8')
    const { resolved, missing } = resolveTokens(template)
    missing.forEach((m) => allMissing.add(m))
    materialized.push({ docKind, body: resolved })
  }

  if (allMissing.size > 0) {
    console.error(
      'Missing env-vars for the following template tokens:\n  - ' +
        [...allMissing].join('\n  - ') +
        '\n\nSet them in the operator env (/etc/levelchannel/env on prod)' +
        ' and re-run. Refusing to write a partial snapshot.',
    )
    process.exit(2)
  }

  // Codex Wave 48 review MEDIUM. All-or-nothing semantics. Three
  // independent UPDATEs would let one missing v1 row slip through as
  // a warning while the other two land — partial snapshot, operator
  // sees "success" exit code. Wrap in a single transaction; abort
  // and rollback on the first missing row (migration 0032 not
  // applied) so the operator sees a hard failure.
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('begin')
    const updated = []
    for (const { docKind, body } of materialized) {
      const result = await client.query(
        `update legal_document_versions
            set body_md = $2
          where doc_kind = $1
            and version_label = 'v1'
          returning id, doc_kind, version_label, length(body_md) as body_len`,
        [docKind, body],
      )
      if (result.rowCount === 0) {
        await client.query('rollback')
        console.error(
          `[${docKind}] no v1 row found — migration 0032 may not be applied. ` +
            'Aborting: rolled back; no v1 rows were touched.',
        )
        process.exit(3)
      }
      updated.push(result.rows[0])
    }
    await client.query('commit')
    for (const row of updated) {
      console.log(
        `[${row.doc_kind}] v1 body updated: id=${row.id}, ${row.body_len} chars`,
      )
    }
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      // best-effort
    }
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('backfill failed:', err)
  process.exit(1)
})
