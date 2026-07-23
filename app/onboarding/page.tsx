'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

// New-player onboarding, in deliberate order (Michael):
//   STEP 1 — PARTY, by itself, big and obvious. This is THE choice.
//   STEP 2 — GENDER: Male / Female / No response (the third option).
// Then → the fighter builder (which is skippable, assigns a default).
type Party = 'democrat' | 'republican'
type Gender = 'male' | 'female' | 'none'

export default function OnboardingPage() {
  const { user } = useUser()
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [party, setParty] = useState<Party | null>(null)
  const [gender, setGender] = useState<Gender | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function finish(g: Gender) {
    setGender(g); setLoading(true); setError('')
    try {
      const res = await fetch('/api/profile/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party, gender: g }),
      })
      if (!res.ok) throw new Error('Failed')
      router.push('/fighter?welcome=1') // build a fighter (or skip → default)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const name = user?.firstName || user?.username || 'Player'

  // ── STEP 1 — PARTY (its own screen) ───────────────────────────────────────
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
        <div className="mb-2 text-center">
          <div className="text-5xl mb-3">🏛️</div>
          <p className="text-gray-500 text-xs font-bold tracking-widest uppercase">Step 1 of 2</p>
          <h1 className="text-4xl font-black text-white mt-2">Pick your party</h1>
          <p className="text-gray-400 mt-2 max-w-xs mx-auto">
            Welcome, <span className="text-white font-bold">{name}</span>. This is the big one — your party
            decides who you battle and which Town Halls you fight for. You can only switch by resetting your account.
          </p>
        </div>

        <div className="w-full max-w-md grid grid-cols-2 gap-4 mt-8">
          <button
            onClick={() => setParty('democrat')}
            className={`aspect-[3/4] rounded-3xl border-4 transition-all flex flex-col items-center justify-center gap-3 p-4 ${
              party === 'democrat' ? 'border-blue-400 bg-blue-950 scale-[1.02] shadow-2xl shadow-blue-900/50'
                : 'border-gray-800 bg-gray-900 hover:border-blue-800'}`}>
            <div className="text-6xl">🔵</div>
            <div className="text-white font-black text-2xl">Democrat</div>
            <div className="text-blue-300/80 text-xs text-center">Fight for progress. Take Town Halls from conservatives.</div>
            {party === 'democrat' && <div className="text-blue-400 text-3xl">✓</div>}
          </button>
          <button
            onClick={() => setParty('republican')}
            className={`aspect-[3/4] rounded-3xl border-4 transition-all flex flex-col items-center justify-center gap-3 p-4 ${
              party === 'republican' ? 'border-red-400 bg-red-950 scale-[1.02] shadow-2xl shadow-red-900/50'
                : 'border-gray-800 bg-gray-900 hover:border-red-800'}`}>
            <div className="text-6xl">🔴</div>
            <div className="text-white font-black text-2xl">Republican</div>
            <div className="text-red-300/80 text-xs text-center">Defend tradition. Take back Town Halls from liberals.</div>
            {party === 'republican' && <div className="text-red-400 text-3xl">✓</div>}
          </button>
        </div>

        <button
          onClick={() => party && setStep(2)}
          disabled={!party}
          className={`w-full max-w-md py-4 mt-8 rounded-2xl font-black text-lg transition-all ${
            party === 'democrat' ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : party === 'republican' ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
          {party ? `I'm a ${party === 'democrat' ? 'Democrat' : 'Republican'} →` : 'Select a party'}
        </button>
      </div>
    )
  }

  // ── STEP 2 — GENDER ───────────────────────────────────────────────────────
  const accent = party === 'democrat' ? 'blue' : 'red'
  const opts: { key: Gender; label: string; emoji: string }[] = [
    { key: 'male', label: 'Male', emoji: '♂️' },
    { key: 'female', label: 'Female', emoji: '♀️' },
    { key: 'none', label: 'No response', emoji: '—' },
  ]
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <p className="text-gray-500 text-xs font-bold tracking-widest uppercase">Step 2 of 2</p>
        <h1 className="text-4xl font-black text-white mt-2">A bit about you</h1>
        <p className="text-gray-400 mt-2">How do you identify?</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {opts.map(o => (
          <button key={o.key}
            onClick={() => setGender(o.key)}
            className={`w-full p-5 rounded-2xl border-2 transition-all flex items-center gap-4 text-left ${
              gender === o.key
                ? accent === 'blue' ? 'border-blue-500 bg-blue-950' : 'border-red-500 bg-red-950'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'}`}>
            <span className="text-3xl w-8 text-center">{o.emoji}</span>
            <span className="text-white font-bold text-lg flex-1">{o.label}</span>
            {gender === o.key && <span className={accent === 'blue' ? 'text-blue-400 text-2xl' : 'text-red-400 text-2xl'}>✓</span>}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

      <div className="w-full max-w-sm mt-8 flex items-center gap-3">
        <button onClick={() => setStep(1)} disabled={loading}
          className="px-5 py-4 rounded-2xl font-bold text-gray-400 bg-gray-900 border border-gray-800 hover:text-white disabled:opacity-50">
          ← Back
        </button>
        <button
          onClick={() => gender && finish(gender)}
          disabled={!gender || loading}
          className={`flex-1 py-4 rounded-2xl font-black text-lg transition-all disabled:opacity-50 ${
            accent === 'blue' ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
          {loading ? '⏳ Setting up…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
