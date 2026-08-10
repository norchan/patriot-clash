'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// Plain VIEW COUNTS. The old "Impre$$ions" earnings page (rates, estimated
// dollars, affiliate CTA) is shelved (Michael 2026-08-10) — it promised cash
// tied to ad revenue that doesn't exist. Views are a fun stat on their own.

function ImpressionsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const postId = searchParams.get('postId')
  const paramCount = parseInt(searchParams.get('count') || '0', 10)

  // Opened from a post → show that post's count. Opened from the profile
  // header 👁 → sum views across all of the player's own posts.
  const [totalCount, setTotalCount] = useState<number | null>(postId ? paramCount : null)
  useEffect(() => {
    if (postId) return
    fetch('/api/posts')
      .then(r => r.json())
      .then(d => setTotalCount((d.posts ?? []).reduce((s: number, p: any) => s + (p.impressions ?? 0), 0)))
      .catch(() => setTotalCount(0))
  }, [postId])

  const count = totalCount ?? 0

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-6 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Back</span>
        </button>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <div className="text-center">
            <div className="text-gray-400 text-sm mb-2">👁 Views</div>
            <div className="text-white font-bold text-3xl mb-2">
              {totalCount === null ? '…' : count.toLocaleString()}
            </div>
            <div className="text-gray-400 text-sm">
              {postId ? 'views on this post' : 'views across all your posts'}
            </div>
          </div>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-gray-500 text-xs">
            A view counts each time someone opens your post. Keep posting to the boards, town halls, and your profile to grow your reach.
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
