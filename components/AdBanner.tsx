'use client'
import { useEffect, useRef } from 'react'

// Fixed bottom banner backed by Google AdSense. Inert until the publisher and
// slot IDs are set in env (NEXT_PUBLIC_ADSENSE_CLIENT / _SLOT), so nothing
// renders or reserves space before AdSense is configured. Mounted by the game
// layout on every page except the immersive battle screens.

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT

export const ADS_ENABLED = !!CLIENT && !!SLOT
export const AD_BAR_HEIGHT = 64 // px

export default function AdBanner() {
  const pushed = useRef(false)

  useEffect(() => {
    if (!ADS_ENABLED || pushed.current) return
    try {
      ;((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
      pushed.current = true
    } catch { /* adsbygoogle not ready yet — it retries its own queue */ }
  }, [])

  if (!ADS_ENABLED) return null

  return (
    <div
      className="fixed left-0 right-0 max-w-md mx-auto z-40 bg-gray-950 border-t border-gray-800 overflow-hidden"
      style={{ bottom: '5rem', height: AD_BAR_HEIGHT }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', height: AD_BAR_HEIGHT }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="false"
      />
    </div>
  )
}
