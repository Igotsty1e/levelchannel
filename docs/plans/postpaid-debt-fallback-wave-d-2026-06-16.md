# Wave-D — postpaid debt UI fallback

Status: SHIPPED 2026-06-16
Parent: docs/plans/teacher-master-flow-2026-06-15.md (Wave 6 — F)
Branch: feat/wave-d-postpaid-debt-ui-2026-06-16

## Контекст

Когда у ученика есть прошедшее `booked`-занятие БЕЗ оплаты, но учитель ещё не подключил приём СБП (`sbpPayEnabled === false`), UI кабинета молча показывает «не оплачено» в списке прошедших — никакого call-to-action, никакого объяснения. Ученик остаётся в неведении что делать.

## Что меняем

`app/cabinet/lessons-section.tsx` — блок «Прошедшие»:

1. **Banner** наверху списка past, если есть booked-unpaid И `sbpPayEnabled=false`:
   > «У вас N прошедших занятий без оплаты. Учитель пока не подключил приём оплаты онлайн — свяжитесь с ним напрямую, он зафиксирует факт оплаты.»

2. **CTA «Оплатить»** на каждой past-строке с booked-unpaid, если `sbpPayEnabled=true` (раньше CTA был только на upcoming).

## Out of scope

- `/teacher/payments` UnpaidLearners — уже корректно показывает unpaid past lessons (manual mark-paid через `confirmClaim` + `createTeacherMarkPaid`).
- Новый endpoint не нужен — `PayLessonModal` уже работает с любым `slotId`.
- Email/TG нотификация ученику про «вы должны оплатить» — отдельный эпик (требует cron-job + dispatch event `MarkPaidExpected`).

## Verification

- `npm run build` — green
- Manual: ученик с `sbpPayEnabled=false` + past booked-unpaid → видит банер
- Manual: ученик с `sbpPayEnabled=true` + past booked-unpaid → видит «Оплатить» CTA
