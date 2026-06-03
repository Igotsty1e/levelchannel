#!/usr/bin/env node
// Content-style check.
//
// Scans user-facing surfaces in `app/` and `components/` for forbidden terms
// documented in `docs/content-style.md` §"Forbidden user-facing terms".
// Catches AI-agent copy drift — e.g. hardcoded English/jargon, internal db
// status names, or placeholder strings on shipped routes.
//
// Exit 0 = pass; exit 1 = at least one violation.
//
// Usage:
//   node scripts/check-content-style.mjs
//   node scripts/check-content-style.mjs --ci    (compact, grep-able output)
//
// Scope: user-facing learner / teacher / public surfaces only. The check
// SKIPS `app/admin/**` because the operator surface legitimately uses
// engineering terminology per docs/content-style.md §2 (operator audience
// tolerates "webhook", "reconciliation" etc.).
//
// Exemption: append `// content-style-allow` (TS) or
// `{/* content-style-allow */}` (JSX) on the SAME line as the term, or on
// the line directly above it. Use sparingly for state-aware placeholders
// (e.g. `app/teacher/settings/calendar/connect-card.tsx`).

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STYLE_DOC = resolve(REPO_ROOT, 'docs/content-style.md')

// User-facing surfaces. Each is a path prefix relative to REPO_ROOT.
// Admin (app/admin) is intentionally excluded — operator audience.
const SCAN_PREFIXES = [
  'app/cabinet',
  'app/teacher',
  'app/register',
  'app/login',
  'app/forgot',
  'app/reset',
  'app/verify-pending',
  'app/verify-failed',
  'app/offer',
  'app/privacy',
  'app/saas',
  'app/saas-offer-accept',
  'app/saas-offer-awaiting',
  'app/pay',
  'app/thank-you',
  'app/t',
  'app/legal',
  'app/checkout',
  'components',
]

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js'])
const EXEMPTION_MARKER = 'content-style-allow'

const PATH_EXCLUSIONS = [
  '/node_modules/',
  '/.next/',
  '/tests/',
  '/__tests__/',
  '/__fixtures__/',
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
]

function listScanFiles() {
  const files = []
  for (const prefix of SCAN_PREFIXES) {
    const full = resolve(REPO_ROOT, prefix)
    if (!existsSync(full)) continue
    try {
      const out = execSync(`find ${full} -type f`, { encoding: 'utf-8' })
      for (const line of out.split('\n')) {
        if (!line) continue
        const lower = line.toLowerCase()
        const hasExt = [...SCAN_EXTENSIONS].some((ext) => lower.endsWith(ext))
        if (!hasExt) continue
        if (PATH_EXCLUSIONS.some((ex) => lower.includes(ex))) continue
        files.push(line)
      }
    } catch {
      // skip
    }
  }
  return files
}

// Parse machine-readable forbidden terms block from docs/content-style.md.
function parseForbiddenTerms() {
  if (!existsSync(STYLE_DOC)) {
    console.error(`FAIL  docs/content-style.md not found at ${STYLE_DOC}`)
    process.exit(2)
  }
  const content = readFileSync(STYLE_DOC, 'utf-8')
  const begin = content.indexOf(
    '<!-- machine-readable-forbidden-terms:begin -->',
  )
  const end = content.indexOf(
    '<!-- machine-readable-forbidden-terms:end -->',
  )
  if (begin === -1 || end === -1 || end <= begin) {
    console.error(
      `FAIL  docs/content-style.md missing machine-readable forbidden-terms markers`,
    )
    process.exit(2)
  }
  const block = content.slice(begin, end)
  const terms = []
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (m) terms.push(m[1].trim())
  }
  return terms
}

function isLineExempted(lines, idx, lineLower) {
  if (lineLower.includes(EXEMPTION_MARKER)) return true
  if (idx > 0) {
    const above = lines[idx - 1].toLowerCase()
    if (above.includes(EXEMPTION_MARKER)) return true
  }
  return false
}

// Heuristic: TS/JS comment lines and JSX attribute lines.
//
// Single-line comment: `// ...` or `* ...` (block-comment continuation).
// JSX attribute hit: the term appears inside `attr="..."` or `attr='...'`.
//   We approximate by checking whether the term substring is wrapped in
//   the same quotation marks AND the line contains an `=` sign before it.
//
// Block comments `/* ... */` spanning multiple lines: tracked via a simple
// open-count state across the file scan.
function preprocessFile(content) {
  const lines = content.split('\n')
  const isCommentLine = new Array(lines.length).fill(false)
  let inBlockComment = false // /* ... */
  let inJsxComment = false // {/* ... */}
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (inJsxComment) {
      isCommentLine[i] = true
      if (trimmed.includes('*/}')) inJsxComment = false
      continue
    }
    if (inBlockComment) {
      isCommentLine[i] = true
      if (trimmed.includes('*/')) inBlockComment = false
      continue
    }
    if (trimmed.startsWith('//')) {
      isCommentLine[i] = true
      continue
    }
    if (trimmed.startsWith('{/*')) {
      isCommentLine[i] = true
      if (!trimmed.includes('*/}')) inJsxComment = true
      continue
    }
    if (trimmed.startsWith('/*')) {
      isCommentLine[i] = true
      if (!trimmed.includes('*/')) inBlockComment = true
      continue
    }
    if (trimmed.startsWith('*')) {
      // Continuation line inside a JSDoc / block comment we already opened
      // (or a stylistic single-line block continuation).
      isCommentLine[i] = true
      continue
    }
  }
  return { lines, isCommentLine }
}

// Skip if term is inside an HTML `placeholder="..."` attribute on the
// same line. We do NOT skip `title=`, `aria-label=`, `alt=`, or other
// user-visible attributes — those ARE user-facing prose and content-style
// should apply to them.
//
// Conservative heuristic, scoped narrowly to the one attribute name
// (`placeholder`) where the literal English word "placeholder" or
// Russian "placeholder text" was the most common false-positive source.
const PLACEHOLDER_ATTRIBUTE_RE = /placeholder\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/gi

function isInPlaceholderAttribute(line, term) {
  PLACEHOLDER_ATTRIBUTE_RE.lastIndex = 0
  const lowerTerm = term.toLowerCase()
  let m
  while ((m = PLACEHOLDER_ATTRIBUTE_RE.exec(line)) !== null) {
    const lowerMatch = m[0].toLowerCase()
    if (lowerMatch.includes(lowerTerm)) return true
  }
  return false
}

function scanFile(path, terms) {
  let content
  try {
    content = readFileSync(path, 'utf-8')
  } catch {
    return []
  }
  const { lines, isCommentLine } = preprocessFile(content)
  const violations = []
  for (let idx = 0; idx < lines.length; idx++) {
    if (isCommentLine[idx]) continue
    const line = lines[idx]
    const lower = line.toLowerCase()
    for (const term of terms) {
      const lowerTerm = term.toLowerCase()
      if (!lower.includes(lowerTerm)) continue
      if (isLineExempted(lines, idx, lower)) continue
      if (isInPlaceholderAttribute(line, term)) continue
      violations.push({
        path,
        line: idx + 1,
        term,
        excerpt: line.trim().slice(0, 120),
      })
    }
  }
  return violations
}

function main() {
  const ci = process.argv.includes('--ci')
  const terms = parseForbiddenTerms()
  if (terms.length === 0) {
    console.error(
      `FAIL  no forbidden terms parsed from docs/content-style.md`,
    )
    process.exit(2)
  }

  const files = listScanFiles()
  const all = []
  for (const f of files) {
    const v = scanFile(f, terms)
    for (const item of v) all.push(item)
  }

  if (all.length === 0) {
    if (ci) {
      console.log(`OK  content-style (scanned ${files.length} files)`)
    } else {
      console.log(`=== content-style check ===`)
      console.log(`scanned ${files.length} files in ${SCAN_PREFIXES.length} dirs`)
      console.log(`forbidden terms: ${terms.length}`)
      console.log('PASS  no violations')
    }
    process.exit(0)
  }

  if (ci) {
    console.error(`FAIL  content-style (${all.length} violation(s))`)
    for (const v of all) {
      console.error(`  ${v.path}:${v.line}  term="${v.term}"  ${v.excerpt}`)
    }
  } else {
    console.log(`=== content-style check ===`)
    console.log(`scanned ${files.length} files`)
    console.log(`forbidden terms: ${terms.length}`)
    console.log(`FAIL  ${all.length} violation(s)`)
    console.log('')
    for (const v of all) {
      console.log(`  ${v.path}:${v.line}`)
      console.log(`    term:    ${v.term}`)
      console.log(`    excerpt: ${v.excerpt}`)
      console.log('')
    }
    console.log(
      `Fix: rephrase per docs/content-style.md, or — for state-aware placeholders only — add`,
    )
    console.log(`     // ${EXEMPTION_MARKER}`)
    console.log(`     on the line above the violation.`)
  }
  process.exit(1)
}

main()
