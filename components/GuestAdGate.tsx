'use client'
import { useEffect, useRef, useState } from 'react'

// Full-page interstitial shown before guests fight sprites or enter the
// arcade. Renders a full-screen AdSense slot when ads are live (post
// approval); until then it's a short branded splash. One showing per
// activity per session.

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT
const ADS_LIVE = !!CLIENT && !!SLOT

export default function GuestAdGate({ gateKey, seconds = 5 }: { gateKey: string; seconds?: number }) {
  const [open, setOpen] = useState(false)
  const [left, setLeft] = useState(seconds)
  const pushed = useRef(false)

  useEffect(() => {
    const k = `adgate_${gateKey}`
    if (sessionStorage.getItem(k)) return
    sessionStorage.setItem(k, '1')
    setOpen(true)
    const iv = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => clearInterval(iv)
  }, [gateKey])

  useEffect(() => {
    if (!open || !ADS_LIVE || pushed.current) return
    try {
      ;((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
      pushed.current = true
    } catch { /* adsbygoogle queue retries on its own */ }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {ADS_LIVE ? (
          <ins
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '100%' }}
            data-ad-client={CLIENT}
            data-ad-slot={SLOT}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        ) : (
          <div className="text-center px-8">
            <div className="text-5xl">🏛️</div>
            <p className="mt-3 text-white font-black text-xl">PoliticsGo</p>
            <p className="mt-1 text-gray-500 text-sm">Guest play is supported by ads.</p>
          </div>
        )}
      </div>
      <div className="p-4 pb-6 flex items-center justify-between bg-gray-950/95 border-t border-gray-800">
        <span className="text-gray-500 text-xs font-bold">Ad · guest mode</span>
        {left > 0 ? (
          <span className="px-5 py-2.5 rounded-xl text-sm font-black text-gray-500 bg-gray-900 border border-gray-800 tabular-nums">
            {left}
          </span>
        ) : (
          <button onClick={() => setOpen(false)}
            className="px-6 py-2.5 rounded-xl text-sm font-black text-white transition active:scale-95"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Continue →
          </button>
        )}
      </div>
    </div>
  )
}
