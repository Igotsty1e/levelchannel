export type NotificationChannel = 'email' | 'telegram' | 'push'

export const NOTIFICATION_EVENT_CATALOG: ReadonlyArray<{
  group: string
  groupLabel: string
  items: ReadonlyArray<{ kind: string; label: string; desc: string }>
}> = [
  {
    group: 'schedule',
    groupLabel: 'Расписание',
    items: [
      {
        kind: 'LessonCancelledByLearner',
        label: 'Отмена занятия учеником',
        desc: 'Ученик отменил забронированный урок.',
      },
      {
        kind: 'LessonCancelledByTeacher',
        label: 'Отмена занятия вами',
        desc: 'Вы отменили урок ученика.',
      },
      {
        kind: 'LessonRescheduledByLearner',
        label: 'Перенос занятия учеником',
        desc: 'Ученик перенёс свой урок.',
      },
      {
        kind: 'LessonRescheduledByTeacher',
        label: 'Перенос занятия вами',
        desc: 'Вы перенесли урок ученика.',
      },
      {
        kind: 'LessonDirectlyAssignedByTeacher',
        label: 'Назначение урока',
        desc: 'Вы назначили урок ученику напрямую (без брони).',
      },
    ],
  },
  {
    group: 'payments',
    groupLabel: 'Оплаты',
    items: [
      {
        kind: 'LessonMarkedPaidByTeacher',
        label: 'Отметка об оплате',
        desc: 'Вы отметили оплату урока вне сервиса.',
      },
      {
        kind: 'SbpClaimSubmittedByLearner',
        label: 'Ученик отправил заявку об оплате',
        desc: 'Ученик сообщил, что оплатил занятие вне сервиса. Вам нужно подтвердить или отклонить оплату.',
      },
      {
        kind: 'PaymentClaimConfirmed',
        label: 'Подтверждение оплаты',
        desc: 'Учитель подтвердил оплату по заявке ученика.',
      },
      {
        kind: 'PaymentClaimDeclined',
        label: 'Отклонение оплаты',
        desc: 'Учитель отклонил заявку на оплату.',
      },
      {
        kind: 'PaymentRefundIssued',
        label: 'Возврат средств',
        desc: 'Учитель оформил возврат по уроку.',
      },
    ],
  },
  {
    group: 'reminders',
    groupLabel: 'Напоминания',
    items: [
      {
        kind: 'LessonMarkedCompleteByTeacher',
        label: 'Отметка о проведённом уроке',
        desc: 'Вы отметили урок как проведённый.',
      },
      {
        kind: 'LessonMarkedNoShowByTeacher',
        label: 'Отметка «ученик не пришёл»',
        desc: 'Вы отметили урок как пропущенный учеником.',
      },
      {
        kind: 'LessonStatusChangedByTeacher',
        label: 'Изменение статуса прошедшего занятия',
        desc: 'Учитель изменил статус занятия постфактум (например, исправил ошибочную отметку).',
      },
    ],
  },
] as const

export const NOTIFICATION_CHANNELS_UI: ReadonlyArray<{
  channel: NotificationChannel
  label: string
}> = [
  { channel: 'email', label: 'Email' },
  { channel: 'telegram', label: 'Telegram' },
  { channel: 'push', label: 'Push' },
] as const
