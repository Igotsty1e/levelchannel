import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

// BCS-DEF-4 (2026-05-19) — pin the read-only placeholder section
// in /cabinet/profile. Per plan §1.7 REVISED + §3.3, this wave ships
// ONLY a placeholder (no toggle, no Server Action, no handshake) so
// the BCS-DEF-4-TG follow-up has a known target.
//
// We pin via source-file presence rather than a full server-component
// render because `app/cabinet/profile/page.tsx` is an async server
// component that depends on `cookies()` / DB session lookup; mocking
// the full surface would yield a brittle test that doesn't add to
// confidence beyond "is this text present?".

const PAGE_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolvePath(here, '../../app/cabinet/profile/page.tsx')
})()

describe('app/cabinet/profile/page.tsx — BCS-DEF-4 Telegram placeholder', () => {
  it('renders the read-only «Напоминания в Telegram» section for learners', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    expect(body).toContain('Напоминания в')
    expect(body).toContain('Telegram')
    expect(body).toContain('LearnerTelegramPlaceholder')
    // The section MUST gate on isTeacher === false (learner-only).
    expect(body).toContain('!isTeacher')
    // No interactive elements this wave (BCS-DEF-4-TG owns those).
    expect(body).not.toMatch(/<input[^>]*name=['"]learner_telegram/i)
    expect(body).not.toMatch(/<button[^>]*onClick=\{handleTelegram/i)
    // No active toggle / handshake mention — placeholder copy only.
    expect(body).toContain('Пока что мы присылаем напоминания только')
  })

  it('uses Russian content-style — non-breaking space + glossary discipline', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    // Non-breaking space between digit / unit / preposition + Telegram
    // is the canonical content-style.md §9 marker; we render it as
    // `&nbsp;` HTML entity in the JSX literal.
    expect(body).toContain('&nbsp;')
    // Glossary discipline — never «урок» on a learner-facing surface;
    // BCS-DEF-4 ships only the placeholder so the only verb-noun the
    // page introduces is «занятие». (Other glossary checks live in
    // the email template test.)
    expect(body).toMatch(/занятия|занятие/)
    expect(body).not.toMatch(/\bурок/i)
  })
})
