import { Banner, Button } from '@/components/ui/primitives'

// Plan-tier write-cap banner stack for /teacher/tariffs and /teacher/
// packages. The two screens share identical UX: when limited tier,
// show one info banner with «N/M использовано»; when cap=0, show one
// banner with a CTA to switch plan; when at cap, show one warning.
// Caller picks the noun («цен» / «пакетов») via props so we don't keep
// two near-identical components.
//
// Anti-pattern fix: previous code rendered TWO banners stacked when
// the cap was reached (info + warning); only one applies at a time —
// we render the most-specific one.

export type CapBannersProps = {
  /** -1 → unlimited (operator-managed); 0 → no creates; 1+ → finite cap. */
  writeCap: number
  /** Server-counted active rows. */
  currentActiveCount: number
  /** RU noun in the «доступно пакетов / цен» phrasing. */
  noun: 'цен' | 'пакетов'
  /** RU singular for «Создание X недоступно». */
  singularPhrase: 'цен занятий' | 'пакетов'
  /** Optional override for the «archive an old to create new» copy. */
  atCapCopy?: string
}

export function CapBanners({
  writeCap,
  currentActiveCount,
  noun,
  singularPhrase,
  atCapCopy,
}: CapBannersProps) {
  const isUnlimited = writeCap < 0
  const noCreatesAtAll = !isUnlimited && writeCap === 0
  const atCap = !isUnlimited && writeCap > 0 && currentActiveCount >= writeCap

  // cap=0 wins (plan_upgrade banner) — overrides the "лимит исчерпан" copy.
  if (noCreatesAtAll) {
    return (
      <Banner
        tone="info"
        action={
          <Button variant="secondary" size="sm" href="/teacher/subscription">
            Поменять тариф
          </Button>
        }
      >
        Создание {singularPhrase} недоступно на вашем тарифе.
      </Banner>
    )
  }

  if (atCap) {
    return (
      <Banner tone="warning" icon="⚠">
        {atCapCopy
          ?? `Лимит ${noun} исчерпан. Архивируйте старый, чтобы создать новый.`}
      </Banner>
    )
  }

  if (!isUnlimited && writeCap > 0) {
    return (
      <Banner tone="info">
        На вашем тарифе доступно {noun}: <strong>{writeCap}</strong>.
        Использовано: <strong>{currentActiveCount}</strong>. Чтобы создавать
        больше — напишите оператору.
      </Banner>
    )
  }

  return null
}
