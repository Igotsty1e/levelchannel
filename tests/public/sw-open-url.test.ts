// BCS-DEF-4-PUSH (2026-06-06) — unit tests for the same-origin URL
// resolver helper loaded by the service worker. Tests import the
// helper file directly (NOT sw.js, which uses classic importScripts
// and would fail under jsdom).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.4 + §4.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function loadResolver(): (url: string, ownOrigin: string) => string {
  const path = resolve(__dirname, '../../public/sw-lib/resolve-open-url.js')
  const source = readFileSync(path, 'utf-8')
  const sandbox: { resolveOpenUrl?: (url: string, ownOrigin: string) => string } = {}
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('self', `${source}; return self.resolveOpenUrl`)
  const resolver = fn(sandbox) as (url: string, ownOrigin: string) => string
  return resolver
}

describe('resolveOpenUrl', () => {
  const resolver = loadResolver()
  const own = 'https://levelchannel.ru'

  it('keeps same-origin URL as path+search+hash', () => {
    expect(resolver('https://levelchannel.ru/cabinet?x=1', own)).toBe(
      '/cabinet?x=1',
    )
  })

  it('falls back to /cabinet for cross-origin URL', () => {
    expect(resolver('https://attacker.example/evil', own)).toBe('/cabinet')
  })

  it('treats a relative string with base as same-origin path', () => {
    // "not a url" is a valid relative reference per WHATWG URL spec when
    // a base is provided — resolves to /<encoded>. Same-origin → keep
    // the path. The dangerous case is an EXPLICIT cross-origin URL.
    expect(resolver('not a url', own)).toBe('/not%20a%20url')
  })

  it('falls back to /cabinet on empty string', () => {
    expect(resolver('', own)).toBe('/cabinet')
  })

  it('falls back to /cabinet on non-string input', () => {
    // @ts-expect-error - intentionally testing wrong type
    expect(resolver(null, own)).toBe('/cabinet')
    // @ts-expect-error - intentionally testing wrong type
    expect(resolver(undefined, own)).toBe('/cabinet')
  })

  it('resolves relative URL against own origin', () => {
    expect(resolver('/cabinet/schedule', own)).toBe('/cabinet/schedule')
  })
})
