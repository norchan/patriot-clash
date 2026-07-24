'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

// The FIGHT button on the public fight-me page (/fight/[id]). Signed-in
// visitors fire the challenge and go straight to the ring; new visitors take
// the sign-up detour and land back here (Clerk redirect_url), where fresh
// accounts may need a beat for the profile webhook — hence the 401 retries.
export default function FightCta({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function fight() {
    setBusy(true); setErr('')
    for (let i = 0; i < 6; i++) {
      try {
        const res = await fetch('/api/pvp/challenge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defender_id: ownerId }),
        })
        if (res.ok) {
          const d = await res.json()
          router.push(`/battle/pvp?id=${d.id}`)
          return
        }
        if (res.status === 401) { // fresh sign-up: profile row still landing
          await new Promise(r => setTimeout(r, 1500))
          continue
        }
        const d = await res.json().catch(() => ({}))
        setErr(d.error ?? 'Could not start the fight')
        break
      } catch {
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    setBusy(false)
  }

  if (!isLoaded) return <div className="h-16" />

  // Guest accept: start a REAL street fight vs the owner (they get pushed
  // into the ring); if one's already live, fall back to the AI demo
  async function guestFight() {
    setBusy(true)
    try {
      const res = await fetch(`/api/public/fight/${ownerId}/start`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.id) { router.push(`/battle/pvp?id=${d.id}&guest=1`); return }
    } catch {}
    router.push(`/battle/pvp?guest=1&vs=${ownerId}`)
  }

  if (!isSignedIn) {
    // no account needed: real live fight vs the owner, right in the browser —
    // the sign-up pitch comes AFTER the fight (Michael)
    return (
      <div className="w-full">
        <button onClick={guestFight} disabled={busy}
          className="block w-full py-4 rounded-2xl font-black text-xl text-white text-center transition active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', boxShadow: '0 8px 30px rgba(220,38,38,0.4)' }}>
          {busy ? '🥊 Entering the ring…' : '⚔️ ACCEPT THE FIGHT'}
        </button>
        <p className="text-gray-500 text-xs text-center mt-2">No account needed — fight right now, in your browser</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <button onClick={fight} disabled={busy}
        className="w-full py-4 rounded-2xl font-black text-xl text-white transition active:scale-95 disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', boxShadow: '0 8px 30px rgba(220,38,38,0.4)' }}>
        {busy ? '🥊 Entering the ring…' : `⚔️ FIGHT ${ownerName.toUpperCase()} NOW`}
      </button>
      {err && <p className="text-red-400 text-sm text-center mt-2">{err}</p>}
    </div>
  )
}
