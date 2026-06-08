'use client'

import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

import { LandingFooter } from '../_shared/footer'
import { LandingHeader } from '../_shared/header'
import { ScrollProgress } from '../_shared/scroll-progress'

import { A01Opening } from './scenes/01-opening'
import { A02Morning } from './scenes/02-morning'
import { A03Noon } from './scenes/03-noon'
import { A04Evening } from './scenes/04-evening'
import { A05Once } from './scenes/05-once'
import { A06Bento } from './scenes/06-bento'
import { A07Everywhere } from './scenes/07-everywhere'
import { A08Final } from './scenes/08-final'

import '../_shared/tokens.css'

export function LandingVariantA({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <main className="landing-v4 landing-v4--a">
      <ScrollProgress />
      <LandingHeader variantHref="/saas/v4-a" />
      <A01Opening />
      <A02Morning />
      <A03Noon />
      <A04Evening />
      <A05Once />
      <A06Bento />
      <A07Everywhere />
      <A08Final />
      <LandingFooter legalProfile={legalProfile} />
    </main>
  )
}
