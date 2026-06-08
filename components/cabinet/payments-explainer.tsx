'use client'

// Re-usable learner-side explainer banner for the SBP-self-service flow.
// Mirrors app/teacher/payments/explainer.tsx but generic over hintKey +
// copy. Renders only when SSR-passed `initiallyDismissed` is false.

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { Banner, Button } from '@/components/ui/primitives'
import type { OnboardingHintKey } from '@/lib/onboarding/keys'

export function LearnerPaymentsExplainer({
  hintKey,
  initiallyDismissed,
  children,
  tone = 'info',
}: {
  hintKey: OnboardingHintKey
  initiallyDismissed: boolean
  children: ReactNode
  tone?: 'info' | 'success' | 'warning'
}) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(initiallyDismissed)

  async function dismiss() {
    setDismissed(true)
    try {
      await fetch('/api/onboarding/dismiss-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hintKey }),
      })
    } catch {
      // best-effort — local state already hides the banner.
    }
    router.refresh()
  }

  if (dismissed) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <Banner
        tone={tone}
        action={
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Понятно
          </Button>
        }
      >
        {children}
      </Banner>
    </div>
  )
}
