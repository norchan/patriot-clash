'use client'
import { Suspense } from 'react'
import SpriteBattle from '@/components/SpriteBattle'

// GUEST SPRITE BATTLE — the SAME 12-second showdown real players get (3D rig,
// rocks + firecrackers, tiers, dodges), just with guest mode on: nothing is
// kept, and the end screen is the sign-up ramp. Shares one component with the
// signed-in battle so the two never drift apart. Ad-gated on the first fight.

export default function GuestBattlePage() {
  return (
    <Suspense fallback={<div className="h-screen bg-gray-950" />}>
      <SpriteBattle guest />
    </Suspense>
  )
}
