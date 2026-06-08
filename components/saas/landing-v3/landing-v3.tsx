'use client'

import { MotionConfig } from 'framer-motion'

import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'

import { LandingV3Footer } from './_shared/footer'
import { LandingV3Header } from './_shared/header'
import { ScrollProgress } from './_shared/scroll-progress'
import { ScreenHero } from './screens/01-hero'
import { ScreenPain1 } from './screens/02-pain-1'
import { ScreenPain2 } from './screens/03-pain-2'
import { ScreenMultiplatform } from './screens/04-multiplatform'
import { ScreenCarousel } from './screens/04b-carousel'
import { ScreenFeatures } from './screens/06-features'
import { ScreenIntegrations } from './screens/06b-integrations'
import { ScreenPullquote } from './screens/06c-pullquote'
import { ScreenSecurity } from './screens/07-security'
import { ScreenPricing } from './screens/08-pricing'
import { ScreenCta } from './screens/10-cta'

import './landing-v3.css'

export function LandingV3({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  return (
    <MotionConfig reducedMotion="user">
      <main className="landing-v3" id="main-content">
        <a href="#main-content" className="skip-link">Перейти к содержимому</a>
        <ScrollProgress />
        <LandingV3Header />
        <ScreenHero />
        <ScreenPain1 />
        <ScreenPain2 />
        <ScreenFeatures />
        <ScreenMultiplatform />
        <ScreenCarousel />
        <ScreenIntegrations />
        <ScreenPullquote />
        <ScreenSecurity />
        <ScreenPricing />
        <ScreenCta />
        <LandingV3Footer legalProfile={legalProfile} />
      </main>
    </MotionConfig>
  )
}
