'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { Zap, CheckCircle } from 'lucide-react'

function ShopSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refetch } = useProfile()
  const [countdown, setCountdown] = useState(5)

  const sessionId = searchParams.get('session_id')

  useEffect(() => {
    const poll = setInterval(() => refetch(), 3000)
    return () => clearInterval(poll)
  }, [refetch])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer)
          router.push('/map')
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 text-green-400">
        <CheckCircle size={72} strokeWidth={1.5} />
      </div>

      <h1 className="text-white text-2xl font-bold mb-2">Purchase Complete!</h1>
      <p className="text-gray-400 text-sm mb-6">
        Your Fighting Points are being credited to your account. This usually takes a few seconds.
      </p>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-8 py-5 mb-8 flex items-center gap-3">
        <Zap size={24} className="text-yellow-400" />
        <span className="text-yellow-400 font-bold text-lg">FP incoming!</span>
      </div>

      {sessionId && (
        <p className="text-gray-600 text-xs mb-6">Order ref: {sessionId.slice(-8).toUpperCase()}</p>
      )}

      <button
        onClick={() => router.push('/map')}
        className="w-full max-w-xs py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition"
      >
        Back to Map ({countdown}s)
      </button>
    </div>
  )
}

export default function ShopSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <ShopSuccessContent />
    </Suspense>
  )
}
