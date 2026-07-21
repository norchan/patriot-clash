'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'

// Reply composer on the public post page. Signed-in → posts a comment;
// signed-out → the join pitch. New replies render inline immediately.

export default function ReplyBox({ postId }: { postId: string }) {
  const { isSignedIn } = useUser()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState<string[]>([])

  if (!isSignedIn) {
    return (
      <div className="py-3.5 border-b border-gray-800 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Join the conversation</p>
        <Link href="/sign-up" className="shrink-0 px-4 py-2 rounded-full text-sm font-black text-white"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          Sign up free
        </Link>
      </div>
    )
  }

  async function send() {
    if (!draft.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/hall-posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error ?? 'Reply failed'); return }
      setSent(s => [...s, draft.trim()])
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="py-3.5 border-b border-gray-800">
      <div className="flex items-end gap-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={500} rows={1}
          placeholder="Post your reply"
          className="flex-1 bg-transparent text-[15px] text-gray-100 placeholder-gray-600 outline-none resize-none py-2" />
        <button onClick={send} disabled={busy || !draft.trim()}
          className="shrink-0 px-4 py-2 rounded-full text-sm font-black text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          {busy ? '…' : 'Reply'}
        </button>
      </div>
      {err && <p className="text-red-400 text-xs mt-1">{err}</p>}
      {sent.map((t, i) => (
        <p key={i} className="mt-2 text-sm text-gray-300 border-l-2 border-purple-700 pl-3 whitespace-pre-wrap break-words">{t}</p>
      ))}
    </div>
  )
}
