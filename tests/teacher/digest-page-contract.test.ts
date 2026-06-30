import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PAGE_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolvePath(here, '../../app/teacher/settings/digest/page.tsx')
})()

describe('/teacher/settings/digest — active channel contract', () => {
  it('does not claim Push is configurable there today', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    expect(body).not.toContain('Email, Telegram, Push')
    expect(body).toContain('Email и Telegram')
  })

  it('pins the matrix to email + telegram only', () => {
    const body = readFileSync(PAGE_PATH, 'utf-8')
    expect(body).toContain("channels={['email', 'telegram']}")
    expect(body).toContain('Push-уведомления для учителей пока не готовы')
  })
})
