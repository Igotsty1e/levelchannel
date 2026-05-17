#!/usr/bin/env node
//
// CRITICAL-PATH-GUARD (2026-05-18 follow-up to PR #275) —
// enforce that PRs touching files in `docs/critical-path.md` carry
// `Codex-Paranoia: SIGN-OFF` (NOT `SUB-WAVE self-reviewed`).
//
// Rationale (docs/critical-path.md §Process gate):
//   These 20 files are the load-bearing money / security / calendar
//   surface. A sub-PR self-review is fine for sub-waves inside an
//   already-planned epic, but a critical-path change MUST always
//   re-run paranoia even if it's a sub-PR.
//
// Inputs (CI):
//   - HEAD vs origin/main diff = the set of files this PR touches.
//   - The PR's commit messages (or the squashed body) = source of
//     the `Codex-Paranoia:` trailer.
//
// Decision:
//   - No critical-path files touched → pass.
//   - Critical-path files touched + SIGN-OFF trailer present → pass.
//   - Critical-path files touched + ESCALATED trailer → pass (the
//     escalation surface is auditable).
//   - Critical-path files touched + only SUB-WAVE trailer → FAIL.
//   - Critical-path files touched + SKIPPED trailer → FAIL.
//   - Critical-path files touched + no trailer at all → FAIL.
//
// Bypass: none. If you genuinely need to ship a critical-path
// change without paranoia, you're in an emergency — document it
// post-incident; the trailer requirement is the audit gate.
//
// Source-of-truth: parsed from docs/critical-path.md so any list
// edit IS the policy update.

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import process from 'node:process'

// 1. Parse critical-path list from docs/critical-path.md.
//
// The doc uses backtick-wrapped paths inside the numbered "the 20"
// section. We pick paths that look like real file refs and end
// with `.ts`. Mentions in the "What is NOT on this list" section
// also match this pattern by accident — so we cut the parse at the
// `## What is NOT on this list` heading.
const DOC_PATH = 'docs/critical-path.md'
const docRaw = readFileSync(DOC_PATH, 'utf-8')
const notSection = docRaw.indexOf('## What is NOT on this list')
const docBody = notSection === -1 ? docRaw : docRaw.slice(0, notSection)
const FILE_REF_RE = /`([^`]+\.ts)`/g

const criticalPathFiles = new Set()
for (const m of docBody.matchAll(FILE_REF_RE)) {
  const p = m[1]
  // Accept only paths with a directory component (filters out
  // bare basename mentions like `deletion-guard.ts` that appear
  // alongside their full-path entry).
  if (p.includes('/')) criticalPathFiles.add(p)
}

if (criticalPathFiles.size === 0) {
  console.error('[critical-path-guard] could not parse any files from', DOC_PATH)
  process.exit(2)
}

// 2. Find the diff base.
//
// In a GitHub Actions PR context, `GITHUB_BASE_REF` is set to the
// target branch (typically `main`). Locally we fall back to
// `origin/main`. The merge-base of HEAD vs that ref is the diff
// base for the PR's actual changes.
const baseRefRaw = process.env.GITHUB_BASE_REF
const baseRef = baseRefRaw ? `origin/${baseRefRaw}` : 'origin/main'

let mergeBase
try {
  mergeBase = execSync(`git merge-base HEAD ${baseRef}`, {
    encoding: 'utf-8',
  }).trim()
} catch (err) {
  console.error('[critical-path-guard] could not compute merge-base vs', baseRef, '-', err instanceof Error ? err.message : err)
  process.exit(2)
}

const changedFilesRaw = execSync(
  `git diff --name-only ${mergeBase}..HEAD`,
  { encoding: 'utf-8' },
).trim()
const changedFiles = changedFilesRaw.split('\n').filter(Boolean)

const touchedCriticalPath = changedFiles.filter((f) =>
  criticalPathFiles.has(f),
)

if (touchedCriticalPath.length === 0) {
  console.log('[critical-path-guard] no critical-path files touched; pass.')
  process.exit(0)
}

console.log(
  '[critical-path-guard] critical-path files touched:',
  touchedCriticalPath.join(', '),
)

// 3. Look for the Codex-Paranoia trailer in commit messages.
const allCommits = execSync(`git log --format=%B ${mergeBase}..HEAD`, {
  encoding: 'utf-8',
})

const SIGN_OFF_RE = /^Codex-Paranoia:\s*SIGN-OFF\b/m
const ESCALATED_RE = /^Codex-Paranoia:\s*ESCALATED\b/m
const SUB_WAVE_RE = /^Codex-Paranoia:\s*SUB-WAVE\b/m
const SKIPPED_RE = /^Codex-Paranoia:\s*SKIPPED\b/m

const hasSignOff = SIGN_OFF_RE.test(allCommits)
const hasEscalated = ESCALATED_RE.test(allCommits)
const hasSubWave = SUB_WAVE_RE.test(allCommits)
const hasSkipped = SKIPPED_RE.test(allCommits)

if (hasSignOff || hasEscalated) {
  console.log(
    '[critical-path-guard] critical-path change carries',
    hasSignOff ? 'SIGN-OFF' : 'ESCALATED',
    '— pass.',
  )
  process.exit(0)
}

console.error(
  '[critical-path-guard] CRITICAL-PATH CHANGE REQUIRES SIGN-OFF',
)
console.error('')
console.error('Touched files:')
for (const f of touchedCriticalPath) console.error('  -', f)
console.error('')
console.error('Trailer state:')
console.error('  Codex-Paranoia: SIGN-OFF   →', hasSignOff)
console.error('  Codex-Paranoia: ESCALATED  →', hasEscalated)
console.error('  Codex-Paranoia: SUB-WAVE   →', hasSubWave)
console.error('  Codex-Paranoia: SKIPPED    →', hasSkipped)
console.error('')
console.error(
  'Critical-path files (docs/critical-path.md) require',
  '`Codex-Paranoia: SIGN-OFF round N/3` (or ESCALATED) in at least one',
  'commit on this branch. SUB-WAVE self-review is insufficient.',
)
process.exit(1)
