'use client'

// Renders the kie.ai asset if it exists at the expected path; otherwise
// shows a labelled placeholder so scaffolding works before assets land.

import { useEffect, useState } from 'react'

type Props = {
  src: string
  alt: string
  aspectRatio?: string
  className?: string
  video?: boolean
}

export function AssetOrPlaceholder({ src, alt, aspectRatio = '3 / 2', className, video = false }: Props) {
  const [exists, setExists] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(src, { method: 'HEAD' })
      .then((r) => !cancelled && setExists(r.ok))
      .catch(() => !cancelled && setExists(false))
    return () => {
      cancelled = true
    }
  }, [src])

  if (exists === null) {
    return (
      <div
        className={className ?? 'landing-v3-placeholder'}
        style={{ aspectRatio }}
        aria-label={alt}
      >
        <span>Loading…</span>
      </div>
    )
  }

  if (!exists) {
    return (
      <div
        className={className ?? 'landing-v3-placeholder'}
        style={{ aspectRatio }}
        aria-label={alt}
      >
        <span>{`kie.ai →  ${src.split('/').pop()}`}</span>
      </div>
    )
  }

  if (video) {
    return (
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        className={className}
        style={{ aspectRatio, objectFit: 'cover', width: '100%', borderRadius: 12 }}
        aria-label={alt}
      />
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ aspectRatio, objectFit: 'cover', width: '100%', borderRadius: 12 }}
    />
  )
}
