// BCS-DEF-4-PUSH (2026-06-06) — Web Push payload template for learner
// lesson-start reminders. Privacy-safe: no zoom URL, no lesson title
// (round-1 WARN 10 closure — lock-screen capability leak).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.5

export function renderLearnerPushPayload({ windowMinutes, cabinetUrl }) {
  return {
    title: 'Скоро урок',
    body: `Через ${windowMinutes} мин начинается ваше занятие. Откройте кабинет, чтобы подключиться.`,
    url: cabinetUrl,
  }
}
