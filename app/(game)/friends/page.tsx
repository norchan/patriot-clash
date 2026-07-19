'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MessageCircle, UserMinus, Check, X } from 'lucide-react'

// My Friends — strictly private: this page only ever shows YOUR list.
// Nobody else can see who your friends are, or how many you have.

interface Row { id: string; profile_id: string; username: string; party: string | null; avatar_url: string | null; since: string }

export default function FriendsPage() {
  const router = useRouter()
  const [friends, setFriends] = useState<Row[]>([])
  const [incoming, setIncoming] = useState<Row[]>([])
  const [outgoing, setOutgoing] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try {
      const d = await fetch('/api/friends').then(r => r.json())
      setFriends(d.friends ?? []); setIncoming(d.incoming ?? []); setOutgoing(d.outgoing ?? [])
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function respond(id: string, accept: boolean) {
    setBusy(id)
    await fetch('/api/friends/respond', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, accept }),
    }).catch(() => {})
    await load(); setBusy(null)
  }
  async function remove(id: string, name: string, isFriend: boolean) {
    if (isFriend && !confirm(`Remove ${name} from your friends?`)) return
    setBusy(id)
    await fetch(`/api/friends?id=${id}`, { method: 'DELETE' }).catch(() => {})
    await load(); setBusy(null)
  }

  const Avatar = ({ r }: { r: Row }) => (
    r.avatar_url
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={r.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-700" />
      : <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-lg">
          {r.party === 'democrat' ? '🔵' : r.party === 'republican' ? '🔴' : '👤'}
        </div>
  )

  const Card = ({ r, children }: { r: Row; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-0">
      <button onClick={() => router.push(`/player/${r.profile_id}`)} className="flex items-center gap-3 flex-1 text-left">
        <Avatar r={r} />
        <span className="text-white text-sm font-bold">{r.username}</span>
      </button>
      {children}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-28">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-bold text-lg">👥 My Friends</h1>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {incoming.length > 0 && (
          <div>
            <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Friend Requests</h3>
            <div className="bg-gray-900 rounded-2xl border border-purple-800/60 overflow-hidden">
              {incoming.map(r => (
                <Card key={r.id} r={r}>
                  <button onClick={() => respond(r.id, true)} disabled={busy === r.id}
                    className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}><Check size={16} /></button>
                  <button onClick={() => respond(r.id, false)} disabled={busy === r.id}
                    className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-40"><X size={16} /></button>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Friends</h3>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            {loading ? (
              <p className="text-gray-600 text-sm text-center py-6">Loading…</p>
            ) : friends.length === 0 ? (
              <div className="text-center py-6 px-4">
                <p className="text-gray-500 text-sm">No friends yet.</p>
                <p className="text-gray-600 text-xs mt-1">Open any player&apos;s profile and tap <b>Add Friend</b> — both parties welcome.</p>
              </div>
            ) : friends.map(r => (
              <Card key={r.id} r={r}>
                <button onClick={() => router.push(`/messages/${r.profile_id}`)}
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}><MessageCircle size={15} /></button>
                <button onClick={() => remove(r.id, r.username, true)} disabled={busy === r.id}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-gray-400 disabled:opacity-40"><UserMinus size={15} /></button>
              </Card>
            ))}
          </div>
        </div>

        {outgoing.length > 0 && (
          <div>
            <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Sent — waiting</h3>
            <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              {outgoing.map(r => (
                <Card key={r.id} r={r}>
                  <button onClick={() => remove(r.id, r.username, false)} disabled={busy === r.id}
                    className="text-xs text-gray-500 hover:text-gray-300 font-bold disabled:opacity-40">CANCEL</button>
                </Card>
              ))}
            </div>
          </div>
        )}

        <p className="text-gray-600 text-[11px] text-center px-4">
          🔒 Your friends list is private. Nobody can see who your friends are — or how many you have. Declines are silent.
        </p>
      </div>
    </div>
  )
}
