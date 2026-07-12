'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocation } from '@/hooks/useLocation'

// Bottom-nav "Town Hall" target: find the closest hall to the player and send
// them straight to it. Falls back to the halls list if location isn't ready.
export default function NearestHallPage() {
  const router = useRouter()
  const { location } = useLocation()
  const [msg, setMsg] = useState('Finding your closest town hall…')

  useEffect(() => {
    if (!location) return
    let cancelled = false
    fetch(`/api/gyms?lat=${location.lat}&lng=${location.lng}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const halls = (d.gyms ?? []).slice().sort(
          (a: any, b: any) => parseFloat(a.distance_miles ?? '9999') - parseFloat(b.distance_miles ?? '9999'))
        if (halls[0]) router.replace(`/townhall/${halls[0].id}`)
        else { setMsg('No town halls found nearby.'); router.replace('/townhall') }
      })
      .catch(() => { if (!cancelled) router.replace('/townhall') })
    return () => { cancelled = true }
  }, [location?.lat, location?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <div className="text-4xl mb-3 animate-pulse">🏛️</div>
      <p className="text-gray-300 text-sm">{msg}</p>
      <button onClick={() => router.replace('/townhall')} className="text-blue-400 text-xs mt-4 underline">
        Browse all town halls
      </button>
    </div>
  )
}
