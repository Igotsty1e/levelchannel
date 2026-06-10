---
title: settings-indicators — убрать badge с Профиль + заменить badge интеграций/приёма на icon-indicator
status: PLAN
date: 2026-06-10
scope: standalone one-PR epic (small UI surface)
owner: ivankhanaev
author: claude
---

# settings-indicators (2026-06-10)

## 0. TL;DR

Полировка hub'а настроек учителя (`/teacher/settings`):

1. **«Профиль»** — убираем status-pill целиком. Раздел не такой важный, бейдж создаёт визуальный шум.
2. **«Интеграции»** — заменяем text-pill (`Подключён` / `Не подключён`) на icon-indicator (зелёная галочка / серый крестик).
3. **«Приём оплат»** — то же: text-pill (`N активных` / `Не настроено`) → icon-indicator (галочка / крестик).

Остальные tiles (Цены занятий, Пакеты занятий, Подписка, Безопасность, Уведомления) — не трогаем.

## 1. Existing surface

Не новый surface — patch existing. Survey-before-plan skip.

Surface:
- `app/teacher/settings/page.tsx` — hub с 8 tiles.
- `components/teacher/settings/settings-tile.tsx` — primitive (rendering один tile).
- `app/globals.css §settings-tile*` — стили (already exists).

## 2. Что меняем

### 2.1 `components/teacher/settings/settings-tile.tsx`

Добавляем взаимно исключающий prop `indicator` через discriminated union (compile-time enforcement):

```ts
type SettingsTileBase = {
  href: string
  icon: ReactNode
  title: string
}
type SettingsTileVariant =
  | { status?: undefined; indicator?: undefined }
  | { status: { label: string; tone: PillTone }; indicator?: undefined }
  | { status?: undefined; indicator: 'connected' | 'not-connected' }
export type SettingsTileProps = SettingsTileBase & SettingsTileVariant
```

Render-логика:
- Если `indicator === 'connected'` → зелёный circular badge с ✓.
- Если `indicator === 'not-connected'` → нейтральный (серый/border-only) circular badge с ✕.
- Если `status` → существующий Pill.
- Если ни одного → ничего (как сейчас «Безопасность», «Подписка»).

A11y:
- Контейнер: `<span class="settings-tile-indicator..." aria-label="Подключено">` / `aria-label="Не подключено"`.
- SVG внутри: `aria-hidden="true"`.

### 2.2 `app/teacher/settings/page.tsx`

Три tile-вызова:

```tsx
// Profile: убираем status целиком
<SettingsTile href="/teacher/profile" icon={<ProfileIcon />} title="Профиль" />

// Интеграции: indicator вместо status
<SettingsTile
  href="/teacher/settings/calendar"
  icon={<IntegrationsGearIcon />}
  title="Интеграции"
  indicator={calendarConnected ? 'connected' : 'not-connected'}
/>

// Приём оплат: indicator вместо status. href-логика остаётся.
<SettingsTile
  href={paymentMethodsCount > 0 ? '/teacher/payments' : '/teacher/settings/payment-methods'}
  icon={<SbpAcceptIcon />}
  title="Приём оплат"
  indicator={paymentMethodsCount > 0 ? 'connected' : 'not-connected'}
/>
```

Остальные tiles остаются как есть.

### 2.3 `app/globals.css`

Добавляем класс `.settings-tile-indicator`:

```css
.settings-tile-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  flex-shrink: 0;
}
.settings-tile-indicator--connected {
  background: var(--success-bg); /* rgba(74, 222, 128, 0.10) — existing token */
  color: var(--success);          /* #4ADE80 — existing token */
}
.settings-tile-indicator--not-connected {
  background: var(--surface-2);
  color: var(--text-tertiary); /* #6E6E76 — нейтральный серый */
  border: 1px solid var(--border);
}
.settings-tile-indicator > svg {
  width: 12px;
  height: 12px;
  display: block;
}
```

**Token decision (round 2):** `--success` и `--success-bg` УЖЕ существуют в `app/globals.css` (`#4ADE80` / `rgba(74,222,128,0.10)`). Берём их. Pill использует «локальный» `#9BDF9B` — это техдолг design-system (см. §3.5: «Success-токен пока не нужен» — устарело относительно реального CSS). Не фиксим Pill в этом PR (out of scope), но и не плодим третий success-зелёный. Будет mini-несоответствие: indicator-зелёный (`#4ADE80`) ≠ Pill success-зелёный (`#9BDF9B`). Поскольку tiles, где сейчас Pill используется с success-tone — «Приём оплат», который мы как раз заменяем на indicator — этот mismatch не видим на одном экране. На других экранах кабинета Pill success используется отдельно (`/teacher/learners`, и т.п.) и indicator там не появится. **Решение принято — используем token.**

### 2.4 SVG глифы

Inline SVG в settings-tile.tsx:

- `<CheckIcon />` — `M5 12l4 4 10-10` stroke-current.
- `<CrossIcon />` — `M6 6l12 12 M6 18L18 6` stroke-current.

Stroke 2px. ViewBox 24×24. Цвет — `currentColor` (наследуется от `.settings-tile-indicator--*`).

## 3. Acceptance criteria

1. На `/teacher/settings`:
   - tile «Профиль» — без badge/indicator в правом краю.
   - tile «Интеграции» — справа кружок-индикатор: зелёный ✓ если `calendarConnected`, серый ✕ если нет.
   - tile «Приём оплат» — справа кружок-индикатор: зелёный ✓ если `paymentMethodsCount > 0`, серый ✕ если 0. href остаётся conditional.
2. Остальные 5 tiles визуально не меняются.
3. A11y: indicator имеет `role="img"` или `<span aria-label="...">`. Screen reader произносит «Подключено» / «Не подключено» в правом столбце tile.
4. Responsive: на mobile (375×812, 360×800) indicator не вылазит за границы tile.
5. Light-mode не задействован (cabinet dark-only).

## 4. Risks

1. **TypeScript mutual exclusion** — мы заявляем `status` и `indicator` оба optional, но семантически взаимно исключающие. Runtime guard простой; если хочется compile-time — можно через discriminated union, но это усложнит API. **Решение:** runtime priority + dev warning.
2. **Color tokens drift** — `#9BDF9B` локализован в Pill. Тут он впервые «вытащен» наружу. **Решение:** одноразово допустимо (по §3.5 explicit allowance); если в третий раз приедет — промоутим в `--success-color`.
3. **Existing tiles, не упомянутые в задаче** — «Цены занятий» / «Пакеты занятий» имеют info-pill (`N активных`). НЕ менять — это count, не connection-status. **Решение:** не трогаем.
4. **Уведомления tile имеет status «Telegram» / «Только e-mail»** — это connection-like, но пользователь его не упомянул. **Решение:** не трогаем, выяснить отдельно если нужно (out of scope).

## 5. Tests

- `npm run test:run` — green (нет unit'ов на settings-tile, ничего не должно сломаться).
- `npm run build` — green.
- `npm run check:env-contract` — green.
- `npm run check:content-style` — green («Подключено» / «Не подключено» — в glossary нет forbidden терминов).
- Browser walkthrough через playwright MCP:
  - desktop 1440×900 — `/teacher/settings` визуально проверить tiles.
  - mobile 375×812 (iPhone) — тот же скрин.
  - mobile 360×800 (Android) — тот же.
- chrome-devtools MCP — console clean, network clean.

E2E `test:e2e:product-flows` — не затрагиваем роуты/редиректы, можно пропустить (или прогнать для sanity).

## 6. Security gate

Нет touch'ей `lib/payments/`, `lib/security/`, `lib/auth/`. `/cso` не требуется per-task.

## 7. Trailers

- `Skill-Used: design-with-claude:visual-hierarchy-specialist`
- `Codex-Paranoia: SELF-REVIEW round N/3 (codex quota exhausted; epic-end replay pending)` (per fallback rule)

## 8. Out of scope

- Иконки/цвета «Уведомления», «Цены занятий», «Пакеты занятий» tiles.
- Промоут `#9BDF9B` в token (отдельный refactor если повторится).
- Изменения в settings sub-страницах (только hub).
