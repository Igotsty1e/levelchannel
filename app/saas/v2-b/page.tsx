// Variant B — Editorial Storytelling preview route.
// Per saas-landing-tier1-v2 plan §11.3 Sub-4 / §0z mount invariant.
// Leaf-only route — NO child routes nested under /saas/v2-b/*.

import type { Metadata } from 'next'

import { LandingB } from '@/components/saas/landing-v2/variant-b/landing-b'
import { loadLegalProfile } from '@/lib/landing/legal-profile-loader'
import '@/components/saas/landing-v2/_shared/landing-footer.css'

export const metadata: Metadata = {
  title: 'LevelChannel — кабинет для репетитора · Variant B preview',
  description:
    'Editorial preview of the SaaS landing for tutors. Internal walkthrough route.',
  robots: { index: false, follow: false },
}

export default function SaasV2BPage() {
  return <LandingB legalProfile={loadLegalProfile()} />
}
