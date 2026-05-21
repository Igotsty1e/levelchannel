import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

// BCS-DEF-4 (2026-05-19) — placeholder section pin.
// Updated BCS-DEF-4-TG (2026-05-20, PR #405) — placeholder replaced
// with the active LearnerTelegramBinding (server component renders
// state; client island owns the Server Action invocations).
// Updated BCS-DEF-5-TG (2026-05-21) — pin learner-only gating + the
// fact that teachers see NO Telegram section on /cabinet/profile (the
// teacher digest opt-in lives at /teacher/settings/digest).
//
// We pin via source-file presence rather than a full server-component
// render because `app/cabinet/profile/page.tsx` is an async server
// component that depends on `cookies()` / DB session lookup; mocking
// the full surface would yield a brittle test that doesn't add to
// confidence beyond "is this binding wired in?".

const PAGE_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolvePath(here, '../../app/cabinet/profile/page.tsx')
})()

describe('app/cabinet/profile/page.tsx — learner Telegram binding gate', () => {
  it('renders LearnerTelegramBinding only when !isTeacher', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    expect(body).toContain('LearnerTelegramBinding')
    // The section MUST gate on isTeacher === false (learner-only).
    expect(body).toContain('!isTeacher')
  })

  it('uses Russian content-style — glossary discipline', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    // Glossary discipline — never «урок» on a learner-facing surface;
    // page should not introduce «урок» (other glossary checks live in
    // the email + telegram template tests).
    expect(body).not.toMatch(/\bурок/i)
  })
})
