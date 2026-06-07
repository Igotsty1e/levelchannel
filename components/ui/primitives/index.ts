// LevelChannel cabinet UI primitives.
//
// Use these instead of inline-styled buttons / badges / banners. If a
// new pattern needs a primitive, extend this catalog FIRST and then
// import — never duplicate styles in screen components.
//
// Tokens these primitives consume live in `app/globals.css`.
// Design contract: `docs/design-system.md`.

export { Button } from './button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './button'

export { ChipGroup } from './chip-group'
export type { ChipGroupProps, ChipOption } from './chip-group'

export { Pill } from './pill'
export type { PillProps, PillTone } from './pill'

export { Banner } from './banner'
export type { BannerProps, BannerTone } from './banner'

export { EmptyState } from './empty-state'
export type { EmptyStateProps } from './empty-state'

export { FloatingActionButton } from './fab'
export type { FloatingActionButtonProps } from './fab'
