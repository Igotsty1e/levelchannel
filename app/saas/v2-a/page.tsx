// Variant A — Cinematic Desk Magic preview route.
// Per saas-landing-tier1-v2 plan §11.3 Sub-3 / §0z mount invariant.
// Leaf-only route — NO child routes nested under /saas/v2-a/*
// (round-2 WARN #8 closure: no-descendants invariant).

import type { Metadata } from 'next'

import { LandingA } from '@/components/saas/landing-v2/variant-a/landing-a'
import { loadLegalProfile } from '@/lib/landing/legal-profile-loader'
import '@/components/saas/landing-v2/_shared/landing-footer.css'

export const metadata: Metadata = {
  title: 'LevelChannel — кабинет для репетитора · Variant A preview',
  description:
    'Cinematic preview of the SaaS landing for tutors. Internal walkthrough route.',
  robots: { index: false, follow: false },
}

export default function SaasV2APage() {
  return <LandingA legalProfile={loadLegalProfile()} />
}
