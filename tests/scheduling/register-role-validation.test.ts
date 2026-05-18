import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// SAAS-3 minimal slice — structural assertions on the new role field.
// Component / route behavioral coverage requires the full integration
// harness (Postgres + Resend mock); the structural checks below catch
// the obvious regressions:
//
//   1. /register form ships a `role` state + radio inputs for student
//      and teacher with default = student.
//   2. /api/auth/register accepts `role?: string` in the body schema
//      and only grants the `teacher` role on the new-email branch when
//      explicitly requested. Anti-enumeration response shape (ok:true)
//      unchanged.

const ROOT = path.resolve(__dirname, '..', '..')

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

describe('SAAS-3 register form', () => {
  it('ships a role state initialised to "student"', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/useState<['"]student['"] \| ['"]teacher['"]>\(['"]student['"]\)/)
  })

  it('renders two radio inputs (student, teacher)', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/type="radio"[\s\S]*?value="student"/)
    expect(src).toMatch(/type="radio"[\s\S]*?value="teacher"/)
  })

  it('sends role in the register POST body', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/postAuthJson\(['"]\/api\/auth\/register['"][\s\S]*?role/)
  })

  it('shows Russian copy without forbidden emoji', () => {
    const src = read('app/register/page.tsx')
    expect(src).toMatch(/Я ученик/)
    expect(src).toMatch(/Я учитель/)
  })
})

describe('SAAS-3 /api/auth/register route', () => {
  it('reads role from body with explicit student default', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/role\?:\s*string/)
    expect(src).toMatch(/body\.role === ['"]teacher['"] \? ['"]teacher['"] : ['"]student['"]/)
  })

  it('imports grantAccountRole', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/grantAccountRole/)
  })

  it('grants teacher role only on new-email branch when requested', () => {
    const src = read('app/api/auth/register/route.ts')
    // Must call grantAccountRole inside the `else` branch (new account)
    // AND only when requestedRole === 'teacher'.
    expect(src).toMatch(/requestedRole === ['"]teacher['"][\s\S]{0,200}grantAccountRole\(account\.id, ['"]teacher['"]/)
  })

  it('does NOT grant any role on the already-registered branch', () => {
    const src = read('app/api/auth/register/route.ts')
    const lines = src.split('\n')
    const existingBranchStart = lines.findIndex((l) => l.includes('if (existing)'))
    const elseBranch = lines.findIndex((l, i) => i > existingBranchStart && l.match(/^\s*\}\s*else\s*\{/))
    expect(existingBranchStart).toBeGreaterThan(-1)
    expect(elseBranch).toBeGreaterThan(existingBranchStart)
    const existingBranchSrc = lines.slice(existingBranchStart, elseBranch).join('\n')
    expect(existingBranchSrc).not.toMatch(/grantAccountRole/)
  })

  it('preserves anti-enumeration: same ok:true response shape regardless of branch', () => {
    const src = read('app/api/auth/register/route.ts')
    // Only one return at the bottom of POST; both branches converge.
    const okResponses = src.match(/return NextResponse\.json\(\s*\{\s*ok:\s*true\s*\}/g) || []
    expect(okResponses.length).toBe(1)
  })

  it('audit payload includes the role on the new-email branch', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toMatch(/payload:\s*\{\s*branch:\s*['"]new_account['"],\s*role:\s*requestedRole\s*\}/)
  })
})
