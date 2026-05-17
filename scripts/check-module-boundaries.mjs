#!/usr/bin/env node
//
// API-BOUNDARIES (2026-05-18) — CI guard for cross-module imports.
//
// Walks every `.ts` / `.tsx` under `app/` and `lib/`. For each
// import matching `from '@/lib/<module>/...'`, applies these rules:
//
// 1. **`internal.ts` is sibling-only.** Any file named `internal.ts`
//    (or `*.internal.ts`) under `lib/X/...` can only be imported
//    from files under the SAME folder. Cross-folder imports fail.
//
// 2. **Facade-folder discipline.** When `lib/X/<sub>/index.ts`
//    exists (e.g. `lib/scheduling/slots/index.ts`), imports from
//    OUTSIDE `lib/X/<sub>/` MUST go through the facade path
//    (`@/lib/X/<sub>` — no trailing file segment). Importing
//    `@/lib/X/<sub>/queries` directly bypasses the facade.
//
// 3. **No rule for flat `lib/X/foo.ts`** (currently most modules).
//    Direct imports stay allowed; future tightening would require
//    introducing an `index.ts` per module first.
//
// Exit 0 on clean; exit 1 + line-numbered report on violation. The
// list in `docs/critical-path.md` does NOT relax these rules —
// critical-path files are MORE load-bearing, not less.
//
// Usage:
//   node scripts/check-module-boundaries.mjs
//
// CI hook:
//   .github/workflows/<...>.yml runs this on every PR; failure blocks merge.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const ROOTS_TO_WALK = ['app', 'lib']
const EXTS = ['.ts', '.tsx', '.mts', '.cts']

function walk(dir, out = []) {
  const entries = readdirSync(dir)
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p)
  }
  return out
}

function isFacadeFolder(absPath) {
  // Heuristic: a folder is a facade folder if it contains `index.ts`.
  try {
    statSync(join(absPath, 'index.ts'))
    return true
  } catch {
    return false
  }
}

const violations = []
const files = ROOTS_TO_WALK.flatMap((r) => walk(join(ROOT, r)))

const IMPORT_RE = /from\s+['"]@\/lib\/([^'"\n]+)['"]/g

for (const filePath of files) {
  const text = readFileSync(filePath, 'utf-8')
  const rel = relative(ROOT, filePath)
  for (const m of text.matchAll(IMPORT_RE)) {
    const importPath = m[1] // e.g. "scheduling/slots/internal"
    const parts = importPath.split('/')

    // Rule 1 — internal.ts is sibling-only.
    const lastPart = parts[parts.length - 1].replace(/\.(ts|tsx|mts|cts)$/, '')
    if (lastPart === 'internal' || lastPart.endsWith('.internal')) {
      // Source file's directory MUST be the same as the import target's directory.
      const sourceDir = dirname(rel) // e.g. "lib/scheduling/slots"
      const targetDir = `lib/${parts.slice(0, -1).join('/')}`
      if (sourceDir !== targetDir) {
        violations.push({
          file: rel,
          import: importPath,
          rule: 'internal.ts is sibling-only',
        })
      }
      continue
    }

    // Rule 2 — facade-folder discipline.
    // For each prefix of the import path, check if that folder has
    // an `index.ts` (= facade folder). If so, ANY trailing segment
    // is a violation when the source file is OUTSIDE that folder.
    for (let i = 1; i < parts.length; i++) {
      const folderRel = `lib/${parts.slice(0, i).join('/')}`
      const folderAbs = join(ROOT, folderRel)
      let isDir = false
      try { isDir = statSync(folderAbs).isDirectory() } catch { isDir = false }
      if (!isDir) continue
      if (!isFacadeFolder(folderAbs)) continue
      // Folder is a facade. Source MUST be inside the folder, OR
      // the import MUST be exactly the facade (no trailing segment
      // beyond `i`).
      const sourceInside = rel.startsWith(folderRel + '/')
      if (sourceInside) continue
      // Source is OUTSIDE the facade folder.
      // The import has a trailing segment past the facade → violation.
      const hasTrailing = parts.length > i
      if (hasTrailing) {
        violations.push({
          file: rel,
          import: importPath,
          rule: `import goes through facade folder ${folderRel}; use '@/${folderRel.replace(/^lib\//, 'lib/')}' (no trailing segment)`,
        })
        break
      }
    }
  }
}

if (violations.length === 0) {
  console.log('[check-module-boundaries] OK — no cross-module boundary violations.')
  process.exit(0)
}

console.error('[check-module-boundaries] FOUND', violations.length, 'violation(s):')
for (const v of violations) {
  console.error(`  ${v.file}: imports @/lib/${v.import} — ${v.rule}`)
}
process.exit(1)
