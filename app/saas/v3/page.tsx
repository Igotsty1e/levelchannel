import { redirect } from 'next/navigation'

// landing-v3 переехал на /, эта ссылка остаётся 301 для старых заходов
export default function LandingV3Redirect() {
  redirect('/')
}
