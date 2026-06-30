'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

export default function OnboardingPage() {
  const { user } = useUser()
  const router = useRouter()
  const [selected, setSelected] = useState<'democrat' | 'republican' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    if (!selected) return
    setLoading(true)
    try {
      const res = await fetch('/api/profile/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party: selected }),
      })
      if (!res.ok) throw new Error('Failed')
      router.push('/map')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <div className="text-5xl mb-3">🏛️</div>
        <h1 className="text-3xl font-bold text-white">PoliticsGo</h1>
        <p className="text-gray-400 mt-2">Choose your side to begin</p>
      </div>

      <div className="mb-8 text-center">
        <p className="text-gray-300 text-lg">
          Welcome, <span className="text-white font-semibold">{user?.firstName || user?.username || 'Player'}</span>!
        </p>
        <p className="text-gray-500 text-sm mt-1">Your choice determines who you fight.</p>
      </div>

      <div className="w-full max-w-sm space-y-4 mb-8">
        <button
          onClick={() => setSelected('democrat')}
          className={`w-full p-5 rounded-2xl border-2 transition-all text-left ${
            selected === 'democrat'
              ? 'border-blue-500 bg-blue-950'
              : 'border-gray-700 bg-gray-900 hover:border-gray-600'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🔵</div>
            <div className="flex-1">
              <div className="text-white font-bold text-lg">Democrat</div>
              <div className="text-gray-400 text-sm mt-1">Fight for progress. Capture Town Halls from conservatives.</div>
            </div>
            {selected === 'democrat' && <div className="text-blue-400 text-2xl">✓</div>}
          </div>
        </button>

        <button
          onClick={() => setSelected('republican')}
          className={`w-full p-5 rounded-2xl border-2 transition-all text-left ${
            selected === 'republican'
              ? 'border-red-500 bg-red-950'
              : 'border-gray-700 bg-gray-900 hover:border-gray-600'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="text-4xl">🔴</div>
            <div className="flex-1">
              <div className="text-white font-bold text-lg">Republican</div>
              <div className="text-gray-400 text-sm mt-1">Defend tradition. Take back Town Halls from liberals.</div>
            </div>
            {selected === 'republican' && <div className="text-red-400 text-2xl">✓</div>}
          </div>
        </button>
      </div>

      <p className="text-gray-600 text-xs text-center mb-6 max-w-xs">
        ⚠️ Choose carefully — you can only switch parties by resetting your account.
      </p>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <button
        onClick={handleJoin}
        disabled={!selected || loading}
        className={`w-full max-w-sm py-4 rounded-2xl font-bold text-lg transition-all ${
          selected === 'democrat' ? 'bg-blue-600 hover:bg-blue-500 text-white' :
          selected === 'republican' ? 'bg-red-600 hover:bg-red-500 text-white' :
          'bg-gray-800 text-gray-600 cursor-not-allowed'
        } disabled:opacity-50`}
      >
        {loading ? '⏳ Joining...' : selected ? `Join the ${selected === 'democrat' ? 'Democrats' : 'Republicans'}!` : 'Select a party'}
      </button>
    </div>
  )
}