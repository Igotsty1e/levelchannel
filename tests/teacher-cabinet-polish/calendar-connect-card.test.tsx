// @vitest-environment jsdom

// Teacher cabinet polish — Sub-PR A (TASK-6).
// Pins the load-bearing claims for connect-card.tsx after the
// configError / !configReady branch unification:
//   - configError set → neutral "Скоро будет" tile renders.
//   - !configReady (no error, just env missing) → SAME neutral tile.
//   - "Напишите оператору" copy is gone from the DOM in both branches.
//   - The stack-trace <details> block no longer exists (no DOM leak
//     of raw env-error messages to teachers).
//
// Note on test location: this lives under `tests/teacher-cabinet-polish/`
// rather than `tests/integration/teacher-cabinet-polish/` from the plan
// because the integration runner (vitest.integration.config.ts) restricts
// to *.test.ts and runs in node-env (no jsdom). RTL component tests must
// live under `tests/` to use the unit runner's jsdom + setup-rtl.ts.
// See docs/plans/teacher-cabinet-polish.md §3 Sub-PR A — assertion
// content (and intent) is preserved verbatim.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CalendarConnectCard } from '@/app/teacher/settings/calendar/connect-card'

describe('CalendarConnectCard — TASK-6 neutral coming-soon tile', () => {
  it('configError set → renders neutral "Скоро будет" tile, no operator email exposure', () => {
    render(
      <CalendarConnectCard
        configReady={false}
        configError={
          'GOOGLE_CALENDAR_OAUTH_CLIENT_ID is required in production'
        }
        isConnected={false}
        syncState={null}
        lastReconnectedAt={null}
      />,
    )

    // Neutral tile copy present.
    expect(screen.getByText(/Скоро будет/)).not.toBeNull()
    expect(
      screen.getByText(/функция активируется в ближайшем обновлении/),
    ).not.toBeNull()
    expect(screen.getByTestId('calendar-coming-soon-tile')).not.toBeNull()

    // Operator email / contact copy must NOT be exposed.
    expect(screen.queryByText(/Напишите оператору/)).toBeNull()
    expect(screen.queryByText(/Интеграция не настроена/)).toBeNull()

    // No raw error detail leaked via <details>.
    const detailsEls = document.querySelectorAll('details')
    expect(detailsEls.length).toBe(0)
    // And the raw configError string itself is not in the DOM.
    expect(
      screen.queryByText(
        /GOOGLE_CALENDAR_OAUTH_CLIENT_ID is required in production/,
      ),
    ).toBeNull()

    // No "Подключить Google Calendar" CTA either (gated branch).
    expect(screen.queryByText(/Подключить Google Calendar/)).toBeNull()
  })

  it('configError null + configReady false → SAME neutral tile (branches unified)', () => {
    render(
      <CalendarConnectCard
        configReady={false}
        configError={null}
        isConnected={false}
        syncState={null}
        lastReconnectedAt={null}
      />,
    )

    expect(screen.getByText(/Скоро будет/)).not.toBeNull()
    expect(screen.getByTestId('calendar-coming-soon-tile')).not.toBeNull()

    // The legacy dev/staging copy must be gone — both branches share copy.
    expect(screen.queryByText(/dev \/ staging/)).toBeNull()
    expect(
      screen.queryByText(/Интеграция временно недоступна на этом окружении/),
    ).toBeNull()

    // Still no operator-email exposure.
    expect(screen.queryByText(/Напишите оператору/)).toBeNull()
  })

  it('configReady true → connect CTA branch renders (configError branch did not swallow it)', () => {
    render(
      <CalendarConnectCard
        configReady={true}
        configError={null}
        isConnected={false}
        syncState={null}
        lastReconnectedAt={null}
      />,
    )

    // The coming-soon tile must NOT render when config is ready.
    expect(screen.queryByTestId('calendar-coming-soon-tile')).toBeNull()
    expect(screen.queryByText(/Скоро будет/)).toBeNull()

    // The real connect CTA appears.
    expect(screen.getByText(/Подключить Google Calendar/)).not.toBeNull()
  })
})
