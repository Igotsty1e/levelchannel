// Variant C — Interactive Demo Playground preview route.
// Per saas-landing-tier1-v2 plan §11.3 Sub-5 / §0z mount invariant.
// Leaf-only route — NO child routes nested under /saas/v2-c/*.
// Demo state lives in localStorage only (BLOCKER #8 closure: server side
// has zero knowledge of demo state; no auth handoff; no persist-on-register).

import type { Metadata } from 'next'

import { LandingC } from '@/components/saas/landing-v2/variant-c/landing-c'
import { loadLegalProfile } from '@/lib/landing/legal-profile-loader'
import '@/components/saas/landing-v2/_shared/landing-footer.css'

export const metadata: Metadata = {
  title: 'LevelChannel — кабинет для репетитора · Variant C preview',
  description:
    'Interactive demo preview of the SaaS landing for tutors. Internal walkthrough route.',
  robots: { index: false, follow: false },
}

export default function SaasV2CPage() {
  return <LandingC legalProfile={loadLegalProfile()} />
}
