import { describe, expect, it } from 'vitest'

import { plural } from '@/lib/text/plural'

describe('plural — Russian noun forms', () => {
  const f = (n: number) => plural(n, 'ученику', 'ученикам', 'ученикам')

  it('0 → many', () => {
    expect(plural(0, 'урок', 'урока', 'уроков')).toBe('уроков')
  })

  it('1 → one', () => {
    expect(plural(1, 'урок', 'урока', 'уроков')).toBe('урок')
  })

  it('2..4 → few', () => {
    expect(plural(2, 'урок', 'урока', 'уроков')).toBe('урока')
    expect(plural(4, 'урок', 'урока', 'уроков')).toBe('урока')
  })

  it('5..10 → many', () => {
    expect(plural(5, 'урок', 'урока', 'уроков')).toBe('уроков')
    expect(plural(10, 'урок', 'урока', 'уроков')).toBe('уроков')
  })

  it('11..14 → many (NOT few; the common pitfall)', () => {
    expect(plural(11, 'урок', 'урока', 'уроков')).toBe('уроков')
    expect(plural(12, 'урок', 'урока', 'уроков')).toBe('уроков')
    expect(plural(13, 'урок', 'урока', 'уроков')).toBe('уроков')
    expect(plural(14, 'урок', 'урока', 'уроков')).toBe('уроков')
  })

  it('21 → one', () => {
    expect(plural(21, 'урок', 'урока', 'уроков')).toBe('урок')
  })

  it('22..24 → few', () => {
    expect(plural(22, 'урок', 'урока', 'уроков')).toBe('урока')
    expect(plural(23, 'урок', 'урока', 'уроков')).toBe('урока')
    expect(plural(24, 'урок', 'урока', 'уроков')).toBe('урока')
  })

  it('25..30 → many', () => {
    expect(plural(25, 'урок', 'урока', 'уроков')).toBe('уроков')
    expect(plural(30, 'урок', 'урока', 'уроков')).toBe('уроков')
  })

  it('domain check: package-issuance footer counter strings', () => {
    expect(f(1)).toBe('ученику')
    expect(f(2)).toBe('ученикам')
    expect(f(5)).toBe('ученикам')
    expect(f(0)).toBe('ученикам')
    expect(f(11)).toBe('ученикам')
  })
})
