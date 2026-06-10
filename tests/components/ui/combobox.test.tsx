// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboboxOption } from '@/components/ui/primitives/combobox'

const OPTIONS: ComboboxOption[] = [
  { value: 'a', label: 'Анна Иванова', sub: 'anna@levelchannel.test' },
  { value: 'p', label: 'Пётр Сидоров', sub: 'petr@levelchannel.test' },
  { value: 's', label: 'Семён Орлов', sub: 'semen@levelchannel.test' },
]

function Harness({
  initial = null,
  onPick = () => {},
}: {
  initial?: string | null
  onPick?: (v: string) => void
}) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <Combobox
      value={value}
      onChange={(v) => {
        setValue(v)
        onPick(v)
      }}
      options={OPTIONS}
      placeholder="Выберите ученика"
    />
  )
}

describe('<Combobox> a11y + behaviour', () => {
  it('renders trigger with placeholder when no value', () => {
    render(<Harness />)
    expect(screen.getByText('Выберите ученика')).toBeTruthy()
  })

  it('renders selected option label after picking', () => {
    render(<Harness initial="a" />)
    expect(screen.getByText('Анна Иванова')).toBeTruthy()
  })

  it('opens the listbox on trigger click', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('aria-expanded reflects open state', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('selects an option on click + closes', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Пётр Сидоров'))
    expect(onPick).toHaveBeenCalledWith('p')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters via ё/й normalisation: query «петр» finds «Пётр»', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button'))
    const search = screen.getByLabelText('Поиск по списку') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'петр' } })
    expect(screen.getByText('Пётр Сидоров')).toBeTruthy()
    expect(screen.queryByText('Анна Иванова')).toBeNull()
  })

  it('filters via ё/й normalisation: query «семен» finds «Семён»', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button'))
    const search = screen.getByLabelText('Поиск по списку') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'семен' } })
    expect(screen.getByText('Семён Орлов')).toBeTruthy()
  })

  it('shows emptyMessage when nothing matches', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button'))
    const search = screen.getByLabelText('Поиск по списку') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'xxxxx' } })
    expect(screen.getByText('Ничего не найдено')).toBeTruthy()
  })

  it('renders loading state when loading=true', () => {
    render(
      <Combobox
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="x"
        loading
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Загрузка…')).toBeTruthy()
  })

  it('renders error state when errorMessage set', () => {
    render(
      <Combobox
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="x"
        errorMessage="Ошибка поиска"
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Ошибка поиска')).toBeTruthy()
  })

  it('disabled trigger does not open', () => {
    render(
      <Combobox
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="x"
        disabled
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renderTrigger custom prop replaces the default button', () => {
    render(
      <Combobox
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        placeholder="x"
        renderTrigger={(props) => (
          <button {...props} type="button">
            Custom
          </button>
        )}
      />,
    )
    expect(screen.getByText('Custom')).toBeTruthy()
  })
})
