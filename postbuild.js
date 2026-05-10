// Static-export post-processor.
//
// Codex Wave 13 Pass 4 #6 — formerly chained off `npm run build` even
// in server-mode builds (where `out/` doesn't exist), executing a
// no-op every time. Worse: a stale `out/` from a prior export run
// would get re-patched against the current build. Now invoked
// explicitly via `npm run build:export`; default `build` is
// server-only and does NOT call this file.
//
// Only run when `out/` was actually emitted by the export step.

const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, 'out')

if (!fs.existsSync(OUT_DIR)) {
  console.log('Post-build HTML fixes skipped: static export is disabled.')
  process.exit(0)
}

function fixHtml(filePath) {
  let html = fs.readFileSync(filePath, 'utf-8')
  const before = html

  // Fix: <meta name="next-size-adjust"/> → <meta name="next-size-adjust" content=""/>
  html = html.replace(/<meta name="next-size-adjust"\/>/g, '<meta name="next-size-adjust" content=""/>')

  if (html !== before) {
    fs.writeFileSync(filePath, html, 'utf-8')
    console.log(`  fixed: ${path.relative(OUT_DIR, filePath)}`)
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.html')) fixHtml(full)
  }
}

console.log('Post-build HTML fixes...')
walk(OUT_DIR)
console.log('Done.')
