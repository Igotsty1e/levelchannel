import { describe, expect, it } from 'vitest'

import { pluralLessons, pluralRu } from '@/lib/util/plural-ru'

const lessonForms = ['занятие', 'занятия', 'занятий'] as const

describe('pluralRu', () => {
  it.each([
    [0, 'занятий'],
    [1, 'занятие'],
    [2, 'занятия'],
    [3, 'занятия'],
    [4, 'занятия'],
    [5, 'занятий'],
    [10, 'занятий'],
    [11, 'занятий'],
    [12, 'занятий'],
    [13, 'занятий'],
    [14, 'занятий'],
    [15, 'занятий'],
    [21, 'занятие'],
    [22, 'занятия'],
    [25, 'занятий'],
    [101, 'занятие'],
    [102, 'занятия'],
    [111, 'занятий'],
    [112, 'занятий'],
    [121, 'занятие'],
  ])('chooses correct form for %d → %s', (n, expected) => {
    expect(pluralRu(n, lessonForms)).toBe(`${n} ${expected}`)
  })

  it('pluralLessons wraps pluralRu with lesson forms', () => {
    expect(pluralLessons(1)).toBe('1 занятие')
    expect(pluralLessons(2)).toBe('2 занятия')
    expect(pluralLessons(5)).toBe('5 занятий')
  })
})
