// Russian plural rules for noun forms. Returns the formatted phrase
// «N <form>» where <form> is chosen per the standard one/few/many
// rule used by Intl.PluralRules('ru'). Examples:
//   pluralRu(1, ['занятие', 'занятия', 'занятий']) → '1 занятие'
//   pluralRu(2, ['занятие', 'занятия', 'занятий']) → '2 занятия'
//   pluralRu(5, ['занятие', 'занятия', 'занятий']) → '5 занятий'
//   pluralRu(21, ['занятие', 'занятия', 'занятий']) → '21 занятие'
//   pluralRu(112, ['занятие', 'занятия', 'занятий']) → '112 занятий'

export function pluralRu(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const abs = Math.abs(n) | 0
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${forms[0]}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} ${forms[1]}`
  }
  return `${n} ${forms[2]}`
}

export function pluralLessons(n: number): string {
  return pluralRu(n, ['занятие', 'занятия', 'занятий'])
}
