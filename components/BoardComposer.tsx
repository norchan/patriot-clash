'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'

// Post box on psub pages (topic/sports/state/user boards). Signed-out
// visitors get the join pitch; new posts render inline above the feed
// (the page itself revalidates on its own cadence).

export default function BoardComposer({ slug }: { slug: string }) {
  const { isSignedIn } = useUser()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [posted, setPosted] = useState<any[]>([])

  if (!isSignedIn) {
    return (
      <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">Want to post here?</p>
        <Link href="/sign-up" className="shrink-0 px-4 py-2 rounded-xl text-sm font-black text-white"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          Join free
        </Link>
      </div>
    )
  }

  async function submit() {
    if (!draft.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/boards/${slug}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Post failed'); return }
      setPosted(p => [d.post, ...p])
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-3">
        <textarea
          value={draft} onChange={e => setDraft(e.target.value)} maxLength={1000} rows={2}
          placeholder={`Post to p/${slug}…`}
          className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none resize-none"
        />
        <div className="flex items-center justify-between">
          {err ? <p className="text-red-400 text-xs">{err}</p> : <span className="text-gray-600 text-[11px]">links get preview cards · posts live 48h</span>}
          <button onClick={submit} disabled={busy || !draft.trim()}
            className="px-4 py-1.5 rounded-xl text-sm font-black text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            {busy ? '…' : 'Post'}
          </button>
        </div>
      </div>
      {posted.map(p => (
        <div key={p.id} className="mt-3 bg-gray-900 border border-purple-800 rounded-2xl p-4">
          <p className="text-[11px] font-black text-purple-400">Posted just now</p>
          <p className="mt-1 text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>
        </div>
      ))}
    </div>
  )
}
