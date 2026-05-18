import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// SAAS-2 admin menu rename — structural assertions on the
// docs/content-style.md §7 proposal applied to
// app/admin/(gated)/layout.tsx.
//
// URLs are pinned untouched so existing bookmarks + operator runbooks
// keep working; only the visible labels move.

const LAYOUT = path.resolve(
  __dirname,
  '..',
  '..',
  'app/admin/(gated)/layout.tsx',
)

function read(): string {
  return readFileSync(LAYOUT, 'utf-8')
}

describe('SAAS-2 admin menu rename', () => {
  it.each([
    ['/admin', 'Сводка'],
    ['/admin/accounts', 'Учётные записи'],
    ['/admin/pricing', 'Тарифы'],
    ['/admin/packages', 'Пакеты занятий'],
    ['/admin/slots', 'Занятия'],
    ['/admin/payments', 'Платежи'],
    ['/admin/refunds', 'Возвраты'],
    ['/admin/debt-summary', 'Задолженности'],
    ['/admin/legal', 'Документы и соглашения'],
    ['/admin/settings/alerts', 'Уведомления оператора'],
    ['/admin/reconciliation', 'Сверка платежей'],
  ])('renders %s as «%s»', (href, label) => {
    const src = read()
    const pattern = new RegExp(
      `href="${href.replace(/\//g, '\\/')}">${label}<\\/AdminNavLink>`,
    )
    expect(src).toMatch(pattern)
  })

  it('does NOT contain the forbidden technical labels anymore', () => {
    const src = read()
    expect(src).not.toMatch(/>Дашборд</)
    expect(src).not.toMatch(/>Аккаунты</)
    // «Слоты» is replaced; the word may still appear in comments —
    // the assertion targets only the <AdminNavLink>…</AdminNavLink>
    // children.
    expect(src).not.toMatch(/AdminNavLink href="\/admin\/slots">Слоты</)
    expect(src).not.toMatch(/AdminNavLink href="\/admin\/legal">Документы</)
    expect(src).not.toMatch(/AdminNavLink href="\/admin\/settings\/alerts">Алерты</)
    expect(src).not.toMatch(/AdminNavLink href="\/admin\/reconciliation">Реконсилиация</)
  })
})
