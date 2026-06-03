#!/usr/bin/env node
// Env contract check.
//
// Scans app/, lib/, scripts/ for `process.env.VAR` and `readEnv(env, 'VAR')`
// patterns. Cross-checks each project-specific env var against `.env.example`
// (primary SoT) and a small operator-tunable subset against `OPERATIONS.md`.
//
// Exit 0 = pass; exit 1 = at least one required var missing from `.env.example`.
//
// Usage:
//   node scripts/check-env-contract.mjs
//   node scripts/check-env-contract.mjs --ci   (machine-friendly output)
//
// Wiring: package.json `check:env-contract`; CI `product-flow-evals.yml`.
//
// Catches the failure mode codified during 2026-06-02 session: prod env vars
// were added in code (GOOGLE_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URL) but
// never landed in .env.example or operator docs, so the feature shipped as
// «Скоро будет» on prod because the operator didn't know to set them.

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_EXAMPLE = resolve(REPO_ROOT, '.env.example')
const OPERATIONS_MD = resolve(REPO_ROOT, 'OPERATIONS.md')

// Framework / system / shell vars — never expected in .env.example.
const FRAMEWORK_VARS = new Set([
  'NODE_ENV',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
  'CI',
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'GIT_SHA',         // set by autodeploy script at build time
  'GITHUB_BASE_REF', // GH Actions
  'GITHUB_HEAD_REF',
  'GITHUB_SHA',
  'GITHUB_REF',
  'SSH_COMMAND_HINT', // diagnostic hint only, set by deploy infra
])

// Vars that are read at runtime but conventionally NOT placed in .env.example
// because they're operator-tunable knobs documented in OPERATIONS.md only.
// Each entry MUST be present in `OPERATIONS.md`.
const OPERATOR_TUNABLE_ONLY = new Set([
  'LEARNER_CANCEL_WINDOW_HOURS',
  'TELEGRAM_API_BASE_URL',
])

const SCAN_DIRS = ['app', 'lib', 'scripts']
// Top-level files outside SCAN_DIRS that still read process.env directly.
// Examples: instrumentation.ts (Sentry server init), instrumentation-client.ts
// (Sentry browser init), proxy.ts (middleware), next.config.js (build-plugin
// env contract).
const SCAN_TOP_FILES = [
  'instrumentation.ts',
  'instrumentation-client.ts',
  'proxy.ts',
  'next.config.js',
]
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.sh'])

// Skip our own scanner files — they contain documentation examples like
// `process.env.VAR_NAME` that would otherwise be flagged as missing-from-env.
const SELF_FILES = new Set([
  'scripts/check-env-contract.mjs',
  'scripts/check-content-style.mjs',
])

function listScanFiles() {
  const files = []
  for (const dir of SCAN_DIRS) {
    const full = resolve(REPO_ROOT, dir)
    if (!existsSync(full)) continue
    try {
      const out = execSync(`find ${full} -type f`, { encoding: 'utf-8' })
      for (const line of out.split('\n')) {
        if (!line) continue
        const lower = line.toLowerCase()
        const hasExt = [...SCAN_EXTENSIONS].some((ext) => lower.endsWith(ext))
        if (!hasExt) continue
        if (lower.includes('/node_modules/')) continue
        if (lower.includes('/.next/')) continue
        const relative = line.startsWith(REPO_ROOT + '/')
          ? line.slice(REPO_ROOT.length + 1)
          : line
        if (SELF_FILES.has(relative)) continue
        files.push(line)
      }
    } catch {
      // skip
    }
  }
  // Top-level files outside SCAN_DIRS.
  for (const name of SCAN_TOP_FILES) {
    const full = resolve(REPO_ROOT, name)
    if (existsSync(full)) files.push(full)
  }
  return files
}

const PROCESS_ENV_RE = /process\.env\.([A-Z_][A-Z0-9_]+)/g
// Matches lib/calendar/google/config.ts pattern: `readEnv(env, 'GOOGLE_CALENDAR_CLIENT_ID')`
const READ_ENV_RE = /readEnv\([^,]+,\s*['"]([A-Z_][A-Z0-9_]+)['"]\s*\)/g
// Matches bracket access patterns:
//   env['NEXT_PUBLIC_LEGAL_OPERATOR_NAME']
//   process.env['FOO']
const BRACKET_ENV_RE =
  /(?:process\.env|env)\[\s*['"]([A-Z_][A-Z0-9_]+)['"]\s*\]/g
// Matches `env.FOO` (destructured / aliased local variable) used in
// lib/db/pool.ts, lib/auth/teacher-invites.ts, lib/legal/public-profile.ts:
//   const env = process.env
//   env.DB_SSL
// We only match when the identifier IS `env`, lowercase, NOT `Env`,
// `ENV`, etc., to avoid false positives on application code that
// happens to have an `env` property.
const ENV_DOT_RE = /(?<![A-Za-z_0-9.])env\.([A-Z_][A-Z0-9_]+)/g

// Vars that are read at runtime via DYNAMIC bracket access (e.g.
// lib/legal/public-profile.ts iterates `legalProfileKeys.filter(key => !env[key])`).
// Such usage is invisible to the static regex scanners above, so we
// pre-declare them here. Mention this set when adding a new
// dynamically-indexed env var. Without this list these vars surface
// as "orphans" in the .env.example warning.
const KNOWN_DYNAMIC_USAGE = new Set([
  'NEXT_PUBLIC_LEGAL_OPERATOR_NAME',
  'NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY',
  'NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID',
  'NEXT_PUBLIC_LEGAL_OPERATOR_OGRN',
  'NEXT_PUBLIC_LEGAL_OPERATOR_REG_AUTHORITY',
  'NEXT_PUBLIC_LEGAL_OPERATOR_CLAIMS_ADDRESS',
  'NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL',
  'NEXT_PUBLIC_LEGAL_BANK_ACCOUNT',
  'NEXT_PUBLIC_LEGAL_BANK_NAME',
  'NEXT_PUBLIC_LEGAL_BANK_BIK',
  'NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT',
  'NEXT_PUBLIC_LEGAL_BANK_CITY',
  // Operator-settings master-switch: read via env[schema.envName] in
  // lib/admin/operator-settings.ts after DB lookup falls back to env.
  'TELEGRAM_ALERTS_MASTER_SWITCH',
  // Build-time only — Sentry plugin in next.config.js consumes this
  // from process env directly; not referenced in source.
  'SENTRY_AUTH_TOKEN',
  // Staging-only env vars surfaced in .env.example for operator
  // discoverability. NEXT_PUBLIC_LC_ENV / NEXT_PUBLIC_STAGING_BANNER
  // have no UI consumer yet — they're documented now so future PRs
  // adding a "this is staging" banner can wire them without an
  // env-contract drift round-trip.
  'NEXT_PUBLIC_LC_ENV',
  'NEXT_PUBLIC_STAGING_BANNER',
])

function scanFile(path) {
  const found = new Map() // var → Set<line>
  let content
  try {
    content = readFileSync(path, 'utf-8')
  } catch {
    return found
  }

  // Only enable ENV_DOT_RE for files that declare `env = process.env`
  // (or have a `process.env` somewhere). This is the standard pattern
  // and avoids matching unrelated `.env` accessors on app objects.
  const hasEnvAlias =
    /const\s+env\s*=\s*process\.env\b/.test(content) ||
    /process\.env\b/.test(content)
  const regexes = [PROCESS_ENV_RE, READ_ENV_RE, BRACKET_ENV_RE]
  if (hasEnvAlias) regexes.push(ENV_DOT_RE)

  const lines = content.split('\n')

  lines.forEach((line, idx) => {
    for (const re of regexes) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        const name = m[1]
        if (!found.has(name)) found.set(name, new Set())
        found.get(name).add(`${path}:${idx + 1}`)
      }
    }
  })
  return found
}

function parseEnvExample() {
  if (!existsSync(ENV_EXAMPLE)) return new Set()
  const content = readFileSync(ENV_EXAMPLE, 'utf-8')
  const names = new Set()
  for (const line of content.split('\n')) {
    // Accept both assignments and commented-out hints: VAR= or #VAR=
    const m = line.match(/^\s*#?\s*([A-Z_][A-Z0-9_]+)\s*=/)
    if (m) names.add(m[1])
  }
  return names
}

function operationsMentions() {
  if (!existsSync(OPERATIONS_MD)) return new Set()
  const content = readFileSync(OPERATIONS_MD, 'utf-8')
  const mentioned = new Set()
  // Treat backtick-bracketed names as mentions.
  const re = /`([A-Z_][A-Z0-9_]+)`/g
  let m
  while ((m = re.exec(content)) !== null) {
    mentioned.add(m[1])
  }
  return mentioned
}

function main() {
  const ci = process.argv.includes('--ci')

  const files = listScanFiles()
  const usage = new Map() // var → Set<file:line>
  for (const f of files) {
    const found = scanFile(f)
    for (const [name, locations] of found) {
      if (!usage.has(name)) usage.set(name, new Set())
      for (const loc of locations) usage.get(name).add(loc)
    }
  }

  const example = parseEnvExample()
  const ops = operationsMentions()

  const usedProjectVars = [...usage.keys()].filter(
    (v) => !FRAMEWORK_VARS.has(v),
  )
  usedProjectVars.sort()

  const missingFromExample = []
  const missingFromOps = []
  const orphanedInExample = []

  for (const v of usedProjectVars) {
    if (OPERATOR_TUNABLE_ONLY.has(v)) {
      // Operator-tunable: requires OPERATIONS.md mention.
      if (!ops.has(v)) missingFromOps.push(v)
    } else {
      // Default: requires .env.example presence.
      if (!example.has(v)) missingFromExample.push(v)
    }
  }

  // Orphans: in .env.example but not used anywhere.
  // Suppress vars known to be read via dynamic bracket access
  // (KNOWN_DYNAMIC_USAGE) so legitimate runtime indirection doesn't
  // produce false-positive orphan warnings.
  for (const v of example) {
    if (FRAMEWORK_VARS.has(v)) continue
    if (KNOWN_DYNAMIC_USAGE.has(v)) continue
    if (!usage.has(v)) orphanedInExample.push(v)
  }
  orphanedInExample.sort()

  const failed = missingFromExample.length > 0 || missingFromOps.length > 0

  if (ci) {
    // Compact, grep-able output.
    if (missingFromExample.length) {
      console.error('FAIL  missing-from-.env.example:')
      for (const v of missingFromExample) {
        const locs = [...(usage.get(v) ?? [])].slice(0, 3).join(' ')
        console.error(`  ${v}  used at: ${locs}`)
      }
    }
    if (missingFromOps.length) {
      console.error('FAIL  missing-from-OPERATIONS.md:')
      for (const v of missingFromOps) {
        const locs = [...(usage.get(v) ?? [])].slice(0, 3).join(' ')
        console.error(`  ${v}  used at: ${locs}`)
      }
    }
    if (orphanedInExample.length) {
      console.error('WARN  orphaned-in-.env.example:')
      for (const v of orphanedInExample) console.error(`  ${v}`)
    }
    if (!failed) console.log('OK  env-contract')
  } else {
    console.log(`=== env-contract check ===`)
    console.log(`scanned ${files.length} files in ${SCAN_DIRS.join(', ')}`)
    console.log(
      `${usedProjectVars.length} project-specific env vars found in code`,
    )
    console.log(`${example.size} vars in .env.example`)
    console.log('')

    if (missingFromExample.length === 0) {
      console.log('PASS  all required vars present in .env.example')
    } else {
      console.log(
        `FAIL  ${missingFromExample.length} var(s) missing from .env.example:`,
      )
      for (const v of missingFromExample) {
        const locs = [...(usage.get(v) ?? [])].slice(0, 3).join(', ')
        console.log(`  - ${v}`)
        console.log(`      used at: ${locs}`)
      }
    }

    if (missingFromOps.length === 0) {
      console.log(
        `PASS  all operator-tunable vars present in OPERATIONS.md`,
      )
    } else {
      console.log(
        `FAIL  ${missingFromOps.length} operator-tunable var(s) missing from OPERATIONS.md:`,
      )
      for (const v of missingFromOps) console.log(`  - ${v}`)
    }

    if (orphanedInExample.length) {
      console.log('')
      console.log(
        `WARN  ${orphanedInExample.length} var(s) in .env.example but not referenced in code:`,
      )
      for (const v of orphanedInExample) console.log(`  - ${v}`)
      console.log(
        '(orphans are not failures; may be stale entries — review and prune.)',
      )
    }
  }

  process.exit(failed ? 1 : 0)
}

main()
