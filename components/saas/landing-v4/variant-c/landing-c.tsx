'use client'

import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

import { LandingFooter } from '../_shared/footer'
import { LandingHeader } from '../_shared/header'
import { ScrollProgress } from '../_shared/scroll-progress'

import { C01Character } from './scenes/01-character'
import { C02Problem } from './scenes/02-problem'
import { C03Guide } from './scenes/03-guide'
import { C04Plan } from './scenes/04-plan'
import { C05Action } from './scenes/05-action'
import { C06Success } from './scenes/06-success'
import { C07Failure } from './scenes/07-failure'
import { C08Bento } from './scenes/08-bento'
import { C09Final } from './scenes/09-final'

import '../_shared/tokens.css'

export function LandingVariantC({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <main className="landing-v4 landing-v4--c">
      <ScrollProgress />
      <LandingHeader variantHref="/saas/v4-c" />
      <C01Character />
      <C02Problem />
      <C03Guide />
      <C04Plan />
      <C05Action />
      <C06Success />
      <C07Failure />
      <C08Bento />
      <C09Final />
      <LandingFooter legalProfile={legalProfile} />
    </main>
  )
}
