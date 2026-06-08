'use client'

import type { ReactNode } from 'react'

// CSS-only laptop chrome. Children renders inside the bezel.
export function LaptopFrame({
  children,
  tilt = 0,
}: {
  children: ReactNode
  tilt?: number
}) {
  return (
    <div
      className="v4-laptop"
      style={tilt ? { transform: `perspective(1400px) rotateX(${tilt}deg)` } : undefined}
    >
      <div className="v4-laptop__screen">{children}</div>
    </div>
  )
}

// CSS-only iPhone chrome.
export function PhoneFrame({
  children,
  tilt = 0,
}: {
  children: ReactNode
  tilt?: number
}) {
  return (
    <div
      className="v4-phone"
      style={tilt ? { transform: `perspective(900px) rotateY(${tilt}deg)` } : undefined}
    >
      <div className="v4-phone__screen">{children}</div>
    </div>
  )
}

// Image inside a device frame with graceful fallback.
export function FrameImage({
  src,
  alt,
  fallback,
}: {
  src: string
  alt: string
  fallback?: ReactNode
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const img = e.currentTarget
        img.style.display = 'none'
        const parent = img.parentElement
        if (parent && fallback === undefined) {
          parent.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--v4-text-muted);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;background:linear-gradient(135deg,#16161A,#1A1818)">${alt}</div>`
        }
      }}
    />
  )
}
