// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NotificationPreferencesMatrix } from '@/components/teacher/notification-preferences-matrix'

describe('NotificationPreferencesMatrix', () => {
  it('can hide Push for the teacher notifications page contract', () => {
    const { getAllByText, queryByText } = render(
      <NotificationPreferencesMatrix
        initialPreferences={[]}
        channels={['email', 'telegram']}
      />,
    )

    expect(getAllByText('Email').length).toBeGreaterThan(0)
    expect(getAllByText('Telegram').length).toBeGreaterThan(0)
    expect(queryByText('Push')).toBeNull()
  })
})
