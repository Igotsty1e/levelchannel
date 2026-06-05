import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

// saas-offer-mutation-wrapper-poc (2026-06-04, plan §0a-7 + §0b-3 + §0c-1)
// — drift-pin for the 3 PoC routes that adopt `runInSaasOfferMutationGate`.
//
// The wrapper pattern is anti-spoof-critical: caller MUST pass
// `auth.account.id` (session-bound), NEVER `body.teacherId` /
// `params.id` / `ctx.params...`. This test reads each PoC route file,
// strips comments via regex, and asserts:
//   1. Canonical call shape `runInSaasOfferMutationGate(auth.account.id,`
//      appears in the handler (non-comment code).
//   2. Negative assertion — no `runInSaasOfferMutationGate(body.` /
//      `(params.` / `(ctx.` occurrences.
//   3. Per-route perimeter ordering — each route's expected token
//      sequence (NOT uniform across routes) appears in order.
//
// Limitations of the regex-strip approach (per plan §0c-2):
//   - `//` or `/*` inside template literals would be incorrectly
//     stripped. Mitigation: the 3 PoC routes don't contain such
//     literals in their POST handlers (manually verified at PR-review
//     time and pinned here for future drift).
//   - This is intentionally NOT a full AST parse — over-engineering
//     for a 3-route allowlist. If/when the parent Sub-A.2-3-5 bundle
//     widens to 24 routes, a TypeScript Compiler API pass can replace
//     this. Out of scope for the PoC.

const REPO_ROOT = resolvePath(__dirname, '..', '..')

const POC_ROUTES_PERIMETER: Record<string, ReadonlyArray<string>> = {
  'app/api/teacher/invites/[id]/revoke/route.ts': [
    'enforceTrustedBrowserOrigin',
    'requireTeacherAndVerified',
    'enforceAccountRateLimit',
    'runInSaasOfferMutationGate',
  ],
  'app/api/teacher/slots/[id]/dismiss-conflict/route.ts': [
    'enforceTrustedBrowserOrigin',
    'enforceRateLimit',
    'requireTeacherAndVerified',
    'runInSaasOfferMutationGate',
  ],
  'app/api/teacher/calendar/orphan-slots/ignore/route.ts': [
    'enforceTrustedBrowserOrigin',
    'enforceRateLimit',
    'requireTeacherAndVerified',
    'runInSaasOfferMutationGate',
  ],
}

function readAndStripComments(relPath: string): string {
  const abs = resolvePath(REPO_ROOT, relPath)
  const raw = readFileSync(abs, 'utf8')
  // Strip block comments first (multi-line), then line comments.
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const noLine = noBlock.replace(/^[ \t]*\/\/.*$/gm, '')
  return noLine
}

// Wave-paranoia R1 WARN #2 closure (2026-06-05): the perimeter-ordering
// assertion runs ONLY over the POST handler body (NOT the import block),
// otherwise the same token names appearing in imports would mask a real
// call-order regression inside the handler. Returns the substring from
// `export async function POST` to the end of the file (handler body +
// any helpers below — the latter is fine because non-POST helpers don't
// reorder the handler's runtime call sequence).
function extractHandlerBody(stripped: string): string {
  const idx = stripped.indexOf('export async function POST')
  if (idx < 0) {
    throw new Error('no POST handler found in stripped source')
  }
  return stripped.slice(idx)
}

describe('saas-offer mutation gate perimeter — drift pin', () => {
  for (const [relPath, expectedOrder] of Object.entries(POC_ROUTES_PERIMETER)) {
    describe(relPath, () => {
      const src = readAndStripComments(relPath)
      const handlerBody = extractHandlerBody(src)

      it('contains canonical call shape `runInSaasOfferMutationGate(auth.account.id,`', () => {
        expect(handlerBody).toContain('runInSaasOfferMutationGate(auth.account.id,')
      })

      it('does NOT pass body / params / ctx into runInSaasOfferMutationGate (anti-spoof)', () => {
        expect(handlerBody).not.toMatch(/runInSaasOfferMutationGate\(\s*body\./)
        expect(handlerBody).not.toMatch(/runInSaasOfferMutationGate\(\s*params\./)
        expect(handlerBody).not.toMatch(/runInSaasOfferMutationGate\(\s*ctx\./)
        expect(handlerBody).not.toMatch(/runInSaasOfferMutationGate\(\s*context\./)
      })

      it('perimeter tokens appear in the documented order INSIDE the POST handler body (NOT just in imports)', () => {
        let cursor = 0
        for (const token of expectedOrder) {
          const pos = handlerBody.indexOf(token, cursor)
          expect(
            pos,
            `token "${token}" expected at or after position ${cursor} in POST handler body`,
          ).toBeGreaterThanOrEqual(0)
          cursor = pos + token.length
        }
      })
    })
  }
})
