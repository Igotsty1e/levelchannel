// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BindCodeModal } from '@/components/teacher/digest-settings/bind-code-modal'

describe('BindCodeModal', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('copies the full /start command instead of the raw code', async () => {
    const { getByRole } = render(
      <BindCodeModal
        code="ZLNLZJFV"
        expiresAt={null}
        botUsername="levelchannel_ops_bot"
        onClose={() => {}}
      />,
    )

    fireEvent.click(getByRole('button', { name: 'Скопировать команду' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '/start ZLNLZJFV',
    )
  })

  it('uses the truthful command-based copy contract', () => {
    const { getAllByText, getByText, queryByText } = render(
      <BindCodeModal
        code="ZLNLZJFV"
        expiresAt={null}
        botUsername="levelchannel_ops_bot"
        onClose={() => {}}
      />,
    )

    expect(getAllByText('/start ZLNLZJFV')).toHaveLength(2)
    expect(
      getByText(/после успешной привязки статус обновится здесь/i),
    ).toBeTruthy()
    expect(queryByText(/распознает оба формата/i)).toBeNull()
  })
})
