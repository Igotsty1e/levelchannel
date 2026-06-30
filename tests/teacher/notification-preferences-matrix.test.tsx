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

  it('does not show stale operator copy for teacher payment actions', () => {
    const { getByText, queryByText } = render(
      <NotificationPreferencesMatrix
        initialPreferences={[]}
        channels={['email', 'telegram']}
      />,
    )

    expect(
      getByText('Учитель подтвердил оплату по заявке ученика.'),
    ).toBeTruthy()
    expect(getByText('Учитель отклонил заявку на оплату.')).toBeTruthy()
    expect(getByText('Учитель оформил возврат по уроку.')).toBeTruthy()
    expect(
      queryByText('Оператор подтвердил оплату по заявке ученика.'),
    ).toBeNull()
    expect(queryByText('Оператор отклонил заявку на оплату.')).toBeNull()
    expect(queryByText('Оператор оформил возврат по уроку.')).toBeNull()
  })

  it('uses human copy for learner payment claims', () => {
    const { getByText, queryByText } = render(
      <NotificationPreferencesMatrix
        initialPreferences={[]}
        channels={['email', 'telegram']}
      />,
    )

    expect(getByText('Ученик отправил заявку об оплате')).toBeTruthy()
    expect(
      getByText(
        'Ученик сообщил, что оплатил занятие вне сервиса. Вам нужно подтвердить или отклонить оплату.',
      ),
    ).toBeTruthy()
    expect(queryByText(/self-service/i)).toBeNull()
  })

  it('groups settings into three collapsible blocks', () => {
    const { getAllByRole, getAllByText, getByText } = render(
      <NotificationPreferencesMatrix
        initialPreferences={[]}
        channels={['email', 'telegram']}
      />,
    )

    expect(getAllByRole('group').length).toBeGreaterThanOrEqual(3)
    expect(getByText('Расписание')).toBeTruthy()
    expect(getByText('Оплаты')).toBeTruthy()
    expect(getByText('Напоминания')).toBeTruthy()
    expect(getAllByText('5 событий')).toHaveLength(2)
    expect(getAllByText('3 события')).toHaveLength(1)
  })
})
