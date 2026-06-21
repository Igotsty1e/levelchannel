// Shared module для server+client использования.
//
// 2026-06-21 — ROOT CAUSE для прод-поломки PR #715+#717. parseKind() жил
// в kind-routing-cards.tsx (которая 'use client'). Server component
// page.tsx импортировал его → Next 16 на runtime throws:
//   "Attempted to call parseKind() from the server but parseKind is on
//    the client. It's not possible to invoke a client function from the
//    server."
//
// Этот модуль НЕ имеет 'use client' и может быть импортирован обеими
// сторонами. type-only export для LessonsKind тоже жил тут.

export type LessonsKind = 'lessons' | 'deals' | 'payments'

export function parseKind(raw: string | null | undefined): LessonsKind {
  if (raw === 'deals' || raw === 'payments') return raw
  return 'lessons'
}
