'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { CREATOR_EARNINGS, estimatedEarnings } from '@/config/creator-earnings'

function ImpressionsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const postId = searchParams.get('postId')
  const paramCount = parseInt(searchParams.get('count') || '0', 10)

  // Opened from a post → show that post's count. Opened from the profile
  // header $ → sum impressions across all of the player's own posts.
  const [totalCount, setTotalCount] = useState<number | null>(postId ? paramCount : null)
  useEffect(() => {
    if (postId) return
    fetch('/api/posts')
      .then(r => r.json())
      .then(d => setTotalCount((d.posts ?? []).reduce((s: number, p: any) => s + (p.impressions ?? 0), 0)))
      .catch(() => setTotalCount(0))
  }, [postId])

  const count = totalCount ?? 0
  const earned = estimatedEarnings(count)
  const rate = CREATOR_EARNINGS.USD_PER_1000_IMPRESSIONS.toFixed(2)

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-6 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Back</span>
        </button>

        {/* Earnings card */}
        <div className="bg-gradient-to-br from-green-900/30 to-green-900/10 border border-green-800 rounded-2xl p-6 mb-6">
          <div className="text-center">
            <div className="text-gray-400 text-sm mb-2">Impressions</div>
            <div className="text-white font-bold text-3xl mb-4">
              {totalCount === null ? '…' : `$${count.toLocaleString()}`}
            </div>
            <div className="text-gray-400 text-sm mb-4">
              {postId ? 'views on this post' : 'views across all your posts'}
            </div>
            <div className="bg-green-900/50 rounded-xl p-4">
              <div className="text-gray-400 text-xs mb-1">Estimated earnings</div>
              <div className="text-green-400 font-bold text-2xl">${earned}</div>
            </div>
          </div>
        </div>

        {/* Earn pitch */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <h2 className="text-white font-bold text-lg mb-3">Anyone can earn money on PoliticsGo</h2>
          <p className="text-gray-400 text-sm mb-4">
            Get paid ${rate} for every 1,000 people who see your content. Earn money when messaging friends, posting pictures, videos, and more!
          </p>
          <ul className="text-gray-400 text-sm space-y-2">
            <li>✓ <strong>Profile posts</strong> — share photos and thoughts</li>
            <li>✓ <strong>Messages</strong> — chat with friends</li>
            <li>✓ <strong>Town hall posts</strong> — engage your community</li>
            <li>✓ <strong>Reels</strong> — coming soon</li>
          </ul>
        </div>

        {/* Affiliate section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-bold text-lg mb-2">Want to earn more?</h2>
          <p className="text-gray-400 text-sm mb-4">
            Invite friends to PoliticsGo and earn money when they post and message. Join the affiliate program to grow your earnings.
          </p>
          <button onClick={() => router.push('/make-money')}
            className="w-full px-4 py-3 bg-purple-700 text-white font-bold rounded-lg hover:bg-purple-600 transition">
            Learn about earnings & affiliate
          </button>
        </div>

        {/* Withdraw info */}
        <div className="mt-6 bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-gray-500 text-xs">
            Earnings available after {CREATOR_EARNINGS.HOLD_DAYS} days. Minimum ${CREATOR_EARNINGS.MIN_WITHDRAW_USD.toFixed(2)} to cash out.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ImpressionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}>
      <ImpressionsContent />
    </Suspense>
  )
}
