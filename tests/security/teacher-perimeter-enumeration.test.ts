import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function findRouteFiles(dir: string, rootDir: string = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...findRouteFiles(full, rootDir))
    } else if (entry === 'route.ts') {
      out.push(full.slice(rootDir.length + 1))
    }
  }
  return out
}

// security-audit-2026-06-02 Sub-PR 1 (F1 closure) — perimeter
// enumeration drift guard.
//
// Every mutation route under /api/teacher/* MUST use either
// requireTeacherAndVerified OR requireTeacherWithCurrentSaasOfferConsent
// (the canonical guards), AND enforceTrustedBrowserOrigin, AND
// enforceRateLimit. The pre-A1.1 inline session+role checks were the
// outlier pattern that F1 closed. This test fails loudly if a NEW
// route lands without the canonical guard set, so the operator
// surface can't silently re-grow the perimeter hole.

const TEACHER_API_ROOT = resolve(
  __dirname,
  '..',
  '..',
  'app',
  'api',
  'teacher',
)

const MUTATION_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

const REQUIRED_GUARDS = [
  'requireTeacherAndVerified',
  'requireTeacherWithCurrentSaasOfferConsent',
]

describe('/api/teacher/* perimeter (F1 drift guard)', () => {
  it('every mutation handler uses a canonical teacher guard + origin + rate-limit', () => {
    const files = findRouteFiles(TEACHER_API_ROOT)
    expect(files.length).toBeGreaterThan(0)

    const offenders: Array<{ file: string; missing: string[] }> = []

    for (const rel of files) {
      const full = resolve(TEACHER_API_ROOT, rel)
      const src = readFileSync(full, 'utf8')

      const hasMutationVerb = MUTATION_VERBS.some((verb) =>
        new RegExp(`export async function ${verb}\\b`).test(src),
      )
      if (!hasMutationVerb) continue

      const usesCanonicalGuard = REQUIRED_GUARDS.some((g) =>
        src.includes(g),
      )
      const usesOrigin = src.includes('enforceTrustedBrowserOrigin')
      const usesRateLimit =
        src.includes('enforceRateLimit')
        || src.includes('enforceAccountRateLimit')

      const missing: string[] = []
      if (!usesCanonicalGuard) {
        missing.push('canonical guard (requireTeacherAndVerified/WithSaasOffer)')
      }
      if (!usesOrigin) missing.push('enforceTrustedBrowserOrigin')
      if (!usesRateLimit) {
        missing.push('rate-limit (enforceRateLimit OR enforceAccountRateLimit)')
      }

      if (missing.length > 0) {
        offenders.push({ file: `app/api/teacher/${rel}`, missing })
      }
    }

    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  - ${o.file}: missing ${o.missing.join(', ')}`)
        .join('\n')
      throw new Error(
        `/api/teacher/* perimeter has ${offenders.length} drift offender(s):\n${msg}\n\nEvery mutation route must use a canonical teacher guard + enforceTrustedBrowserOrigin + enforceRateLimit.`,
      )
    }

    expect(offenders).toHaveLength(0)
  })

  // R1-BLOCKER#1 (codex-paranoia round 1) closure — the F1 outliers
  // now carry a per-handler ORDER assertion. For IP-scoped rate-limit
  // routes the order must be:
  //   enforceTrustedBrowserOrigin → enforceRateLimit → requireTeacher*
  // Origin is first so anonymous cross-site POSTs drop before any
  // expensive check. Rate-limit before auth so unauthenticated
  // attackers can't bypass it via timing on the auth guard.
  function extractHandler(src: string, verb: string): string | null {
    const re = new RegExp(
      `export async function ${verb}\\b[\\s\\S]*?\\n\\}\\n`,
      'm',
    )
    const m = src.match(re)
    return m ? m[0] : null
  }

  function assertIpScopedOrder(handlerSrc: string, namespace: string) {
    const iOrigin = handlerSrc.indexOf('enforceTrustedBrowserOrigin(')
    const iRl = handlerSrc.indexOf('enforceRateLimit(')
    const iAuth =
      handlerSrc.indexOf('requireTeacherWithCurrentSaasOfferConsent(')
    expect(iOrigin, 'enforceTrustedBrowserOrigin call site').toBeGreaterThan(-1)
    expect(iRl, 'enforceRateLimit call site').toBeGreaterThan(-1)
    expect(iAuth, 'auth guard call site').toBeGreaterThan(-1)
    expect(iOrigin, 'origin must precede rate-limit').toBeLessThan(iRl)
    expect(iRl, 'rate-limit must precede auth').toBeLessThan(iAuth)
    expect(handlerSrc).toContain(namespace)
  }

  it('tariffs/[id]/access POST + DELETE: order origin → rate-limit → auth (R1-B#1)', () => {
    const src = readFileSync(
      resolve(TEACHER_API_ROOT, 'tariffs/[id]/access/route.ts'),
      'utf8',
    )
    const post = extractHandler(src, 'POST')
    const del = extractHandler(src, 'DELETE')
    expect(post, 'POST handler present').not.toBeNull()
    expect(del, 'DELETE handler present').not.toBeNull()
    assertIpScopedOrder(post!, "'teacher:tariff-access:ip'")
    assertIpScopedOrder(del!, "'teacher:tariff-access:ip'")
  })

  it('learners/[id]/billing PATCH: order origin → rate-limit → auth (R1-B#1)', () => {
    const src = readFileSync(
      resolve(TEACHER_API_ROOT, 'learners/[id]/billing/route.ts'),
      'utf8',
    )
    const patch = extractHandler(src, 'PATCH')
    expect(patch, 'PATCH handler present').not.toBeNull()
    assertIpScopedOrder(patch!, "'teacher:learner-billing:ip'")
  })
})
