'use client'
import { Suspense } from 'react'
import SpriteBattle from '@/components/SpriteBattle'

// SPRITE BATTLE (signed-in) — the 12-second showdown, played from the map.
// The whole fight lives in the shared <SpriteBattle> component so guests get
// the exact same experience at /play/battle (with guest mode on).

export default function BattlePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#050a14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Loading...</span>
      </div>
    }>
      <SpriteBattle />
    </Suspense>
  )
}
