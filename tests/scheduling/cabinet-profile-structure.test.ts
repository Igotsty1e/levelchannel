import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// SAAS-5 structural negative-assertion tests. Per the plan, vitest is
// node-env without jsdom/RTL, so we cannot render the Server Component
// directly. Instead we read the source files and assert the IA refactor
// invariants are preserved:
//
//  1. /cabinet does NOT import ProfileEditor or DangerZone.
//  2. /cabinet DOES render a Link to /cabinet/profile.
//  3. /cabinet/profile exists, imports ProfileEditor + DangerZone, gates
//     auth identically to /cabinet (cookies → session → admin → /admin).
//
// This is the "silent-green-on-the-wrong-path" defence captured in
// docs/plans/cabinet-profile-button.md §6.ii. A future refactor that
// accidentally re-introduces ProfileEditor on /cabinet fails this test.

const ROOT = path.resolve(__dirname, '..', '..')
const CABINET_PAGE = path.join(ROOT, 'app/cabinet/page.tsx')
const CABINET_PROFILE_PAGE = path.join(ROOT, 'app/cabinet/profile/page.tsx')

function read(p: string): string {
  return readFileSync(p, 'utf-8')
}

describe('SAAS-5 cabinet IA refactor — /cabinet main page', () => {
  it('does NOT import ProfileEditor anymore', () => {
    const src = read(CABINET_PAGE)
    expect(src).not.toMatch(/from\s+['"]\.\/profile-editor['"]/)
    expect(src).not.toMatch(/<ProfileEditor\b/)
  })

  it('does NOT import DangerZone anymore', () => {
    const src = read(CABINET_PAGE)
    expect(src).not.toMatch(/from\s+['"]\.\/danger-zone['"]/)
    expect(src).not.toMatch(/<DangerZone\b/)
  })

  it('renders a Link to /cabinet/profile', () => {
    const src = read(CABINET_PAGE)
    expect(src).toMatch(/href="\/cabinet\/profile"/)
    expect(src).toMatch(/Профиль/)
  })

  it('still imports LessonsSection (primary surface stays)', () => {
    const src = read(CABINET_PAGE)
    expect(src).toMatch(/from\s+['"]\.\/lessons-section['"]/)
  })
})

describe('SAAS-5 cabinet IA refactor — /cabinet/profile sub-page', () => {
  it('exists at app/cabinet/profile/page.tsx', () => {
    const src = read(CABINET_PROFILE_PAGE)
    expect(src.length).toBeGreaterThan(0)
  })

  it('declares noindex robots metadata', () => {
    const src = read(CABINET_PROFILE_PAGE)
    expect(src).toMatch(/robots:\s*{\s*index:\s*false/)
  })

  it('imports LearnerProfileCard and LearnerDangerCard (2026-06-25 redesign)', () => {
    // Before 2026-06-25: imported from ../profile-editor + ../danger-zone.
    // After Bug 3 fix: redesigned components live in @/components/cabinet/.
    // Точная import-assertion + render-assertion (paranoia WARN #5 fix —
    // не string-search чтобы не дать silent-green на dead code в комментариях).
    const src = read(CABINET_PROFILE_PAGE)
    expect(src).toMatch(
      /from\s+['"]@\/components\/cabinet\/learner-profile-card['"]/,
    )
    expect(src).toMatch(
      /from\s+['"]@\/components\/cabinet\/learner-danger-card['"]/,
    )
    expect(src).toMatch(/<LearnerProfileCard\b/)
    expect(src).toMatch(/<LearnerDangerCard\b/)
  })

  it('gates session via cookies + lookupSession + admin → /admin redirect', () => {
    const src = read(CABINET_PROFILE_PAGE)
    expect(src).toMatch(/SESSION_COOKIE_NAME/)
    expect(src).toMatch(/lookupSession/)
    expect(src).toMatch(/redirect\(['"]\/login['"]\)/)
    expect(src).toMatch(/redirect\(['"]\/admin['"]\)/)
  })

  it('renders a back link to /cabinet', () => {
    const src = read(CABINET_PROFILE_PAGE)
    expect(src).toMatch(/href="\/cabinet"/)
    expect(src).toMatch(/Назад в кабинет/)
  })

  it('renders the email-verification banner when not verified', () => {
    const src = read(CABINET_PROFILE_PAGE)
    expect(src).toMatch(/isVerified/)
    expect(src).toMatch(/E-mail ещё не подтверждён/)
  })
})
