'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// The little +/✓ next to a psub row — subscribing adds it to the homepage
// tab strip and pins it into Featured on /p.

export default function SubscribeButton({ slug, initial, signedIn }: {
  slug: string
  initial: boolean
  signedIn: boolean
}) {
  const router = useRouter()
  const [sub, setSub] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    if (!signedIn) { router.push('/sign-up'); return }
    if (busy) return
    setBusy(true)
    const next = !sub
    setSub(next)
    try {
      const res = await fetch(`/api/boards/${slug}/subscribe`, { method: 'POST' })
      const d = await res.json()
      if (res.ok) setSub(d.subscribed)
      else setSub(!next)
    } catch {
      setSub(!next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={toggle} disabled={busy}
      title={sub ? 'Unsubscribe' : 'Subscribe — adds this psub to your homepage tabs'}
      className={`shrink-0 w-7 h-7 rounded-lg text-sm font-black flex items-center justify-center transition border ${
        sub
          ? 'bg-purple-700 border-purple-400 text-white'
          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-purple-600'}`}>
      {sub ? '✓' : '+'}
    </button>
  )
}
