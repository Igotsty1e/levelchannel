// SAAS-INFRA-1 — RTL setup. Loaded globally per vitest.config.ts
// `setupFiles`. Activates only when a test file uses the
// `// @vitest-environment jsdom` directive at the top (i.e. has a real
// DOM). In node-env tests `cleanup()` becomes a no-op against jsdom's
// absence and the matchers don't fire because nothing renders. Safe
// across both environments.
//
// Use the explicit ESM subpath import for jest-dom matchers — see
// docs/plans/saas-infra-1-jsdom-rtl.md R3 (vitest+RTL+Node 20 ESM
// pitfall). Importing from `@testing-library/jest-dom` (no subpath)
// sometimes auto-installs the matchers against the wrong expect.

import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
afterEach(() => {
  cleanup()
})
