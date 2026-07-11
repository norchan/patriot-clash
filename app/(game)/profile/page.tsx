'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { useProfile } from '@/hooks/useProfile'
import { LogOut, Zap, Footprints, Swords, Flag, Camera, Pencil, Check, X } from 'lucide-react'

interface BattleRecord {
  id: string
  enemy_type: string
  result: 'victory' | 'defeat' | 'fled'
  fp_spent: number
  created_at: string
}

const ENEMY_LABELS: Record<string, string> = {
  oil_baron: 'Oil Baron', cowboy: 'Lone Star', politician: 'The Don',
  eagle: 'Freedom Eagle', hick: 'Good Ole Boy',
  crazy_liberal: 'Policy Wonk', crying_liberal: 'Tear Drop',
  dem_politician: 'Shadow Senator', purple_hair: 'Purple Fury', protestor: 'Riot Gear',
}

const RANKS = [
  { title: 'Newcomer',   min: 0,   color: '#6b7280' },
  { title: 'Recruit',    min: 5,   color: '#22c55e' },
  { title: 'Activist',   min: 20,  color: '#3b82f6' },
  { title: 'Campaigner', min: 50,  color: '#8b5cf6' },
  { title: 'Veteran',    min: 100, color: '#f59e0b' },
  { title: 'Commander',  min: 200, color: '#ef4444' },
  { title: 'Legend',     min: 500, color: '#f97316' },
]

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

interface BlockedPlayer {
  id: string
  username: string
  blocked_at: string
}

interface Post {
  id: string
  content: string
  created_at: string
}

// Resize any picked image to a 256px square JPEG data URL before upload
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')!
      // cover-crop to square
      const s = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function ProfilePage() {
  const router = useRouter()
  const { signOut } = useClerk()
  const { profile, loading, refetch } = useProfile()
  const [battles, setBattles] = useState<BattleRecord[]>([])
  const [battlesLoading, setBattlesLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [blockedPlayers, setBlockedPlayers] = useState<BlockedPlayer[]>([])
  const [showBlocked, setShowBlocked] = useState(false)

  // Photo, click, posts
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cliqueName, setCliqueName] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [postText, setPostText] = useState('')
  const [posting, setPosting] = useState(false)
  const [todaySteps, setTodaySteps] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(d => setPosts(d.posts ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Today's steps: prefer the live local count, fall back to the server record
    const now = new Date()
    const key = `steps_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const local = parseInt((typeof window !== 'undefined' && localStorage.getItem(key)) || '0', 10)
    setTodaySteps(local)
    fetch('/api/steps')
      .then(r => r.json())
      .then(d => {
        const todayStr = key.replace('steps_', '')
        const rec = (d.steps ?? []).find((s: any) => s.record_date === todayStr)
        const server = rec?.step_count ?? 0
        setTodaySteps(prev => Math.max(prev ?? 0, server))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!profile?.clique_id) { setCliqueName(null); return }
    fetch(`/api/cliques/${profile.clique_id}`)
      .then(r => r.json())
      .then(d => setCliqueName(d.clique?.name ?? null))
      .catch(() => {})
  }, [profile?.clique_id])

  async function saveName() {
    const name = nameDraft.trim()
    if (savingName) return
    if (name === profile?.username) { setEditingName(false); return }
    setSavingName(true)
    setNameError('')
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      })
      const data = await res.json()
      if (!res.ok) { setNameError(data.error || 'Could not save name'); return }
      await refetch()
      setEditingName(false)
    } catch { setNameError('Could not save name') }
    finally { setSavingName(false) }
  }

  async function uploadPhoto(file: File) {
    setUploading(true)
    try {
      const dataUrl = await resizeImage(file)
      const res = await fetch('/api/profile/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      if (res.ok) await refetch()
    } catch {}
    setUploading(false)
  }

  async function publishPost() {
    if (!postText.trim()) return
    setPosting(true)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: postText.trim() }),
      })
      const data = await res.json()
      if (data.post) {
        setPosts(prev => [data.post, ...prev])
        setPostText('')
      }
    } catch {}
    setPosting(false)
  }

  async function deletePost(id: string) {
    setPosts(prev => prev.filter(p => p.id !== id))
    fetch(`/api/posts/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  async function toggleSetting(key: 'allow_pvp_messages' | 'allow_messages' | 'show_party', current: boolean) {
    setToggling(key)
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !current }),
      })
      await refetch()
    } catch {}
    setToggling(null)
  }

  async function loadBlocked() {
    try {
      const res = await fetch('/api/players/block')
      const data = await res.json()
      setBlockedPlayers(data.blocked ?? [])
      setShowBlocked(true)
    } catch {}
  }

  async function unblock(id: string) {
    try {
      await fetch('/api/players/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_id: id }),
      })
      setBlockedPlayers(prev => prev.filter(p => p.id !== id))
    } catch {}
  }

  useEffect(() => {
    fetch('/api/battles?limit=10')
      .then(r => r.json())
      .then(d => setBattles(d.battles ?? []))
      .catch(() => {})
      .finally(() => setBattlesLoading(false))
  }, [])

  const rank = RANKS.slice().reverse().find(r => (profile?.total_battles_won || 0) >= r.min) || RANKS[0]
  const nextRank = RANKS.find(r => r.min > (profile?.total_battles_won || 0))
  const progressToNext = nextRank
    ? Math.min(100, ((profile?.total_battles_won || 0) - rank.min) / (nextRank.min - rank.min) * 100)
    : 100
  const winRate = (profile?.total_battles_won || 0) + (profile?.total_battles_lost || 0) > 0
    ? Math.round((profile!.total_battles_won / (profile!.total_battles_won + profile!.total_battles_lost)) * 100)
    : 0

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading profile...</div>
      </div>
    )
  }

  const partyColor = profile?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const partyEmoji = profile?.party === 'democrat' ? '🔵' : '🔴'
  const partyName  = profile?.party === 'democrat' ? 'Democrat' : 'Republican'

  return (
    <div className="min-h-screen bg-gray-950 pb-6">

      {/* Hero header */}
      <div className="px-4 pt-8 pb-6"
        style={{ background: `linear-gradient(180deg, ${partyColor}33 0%, transparent 100%)` }}>
        <div className="flex items-center gap-4">
          {/* Avatar — ring is party-colored, or white when affiliation is hidden */}
          <div className="relative flex-shrink-0">
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="block">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Profile"
                  className="w-16 h-16 rounded-full object-cover border-[3px]"
                  style={{ borderColor: profile?.show_party === false ? '#e5e7eb' : partyColor, opacity: uploading ? 0.5 : 1 }} />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl border-[3px]"
                  style={{ borderColor: profile?.show_party === false ? '#e5e7eb' : partyColor, background: `${partyColor}33`, opacity: uploading ? 0.5 : 1 }}>
                  {partyEmoji}
                </div>
              )}
            </button>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center pointer-events-none">
              <Camera size={12} className="text-gray-300" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div>
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={e => { setNameDraft(e.target.value); setNameError('') }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveName()
                      if (e.key === 'Escape') { setEditingName(false); setNameError('') }
                    }}
                    maxLength={20}
                    className="bg-gray-800 text-white font-bold text-lg rounded-lg px-2 py-1 w-full min-w-0 outline-none border border-gray-700 focus:border-gray-500"
                  />
                  <button onClick={saveName} disabled={savingName}
                    className="p-1.5 rounded-lg bg-green-600 text-white disabled:opacity-50 flex-shrink-0">
                    <Check size={14} />
                  </button>
                  <button onClick={() => { setEditingName(false); setNameError('') }}
                    className="p-1.5 rounded-lg bg-gray-700 text-gray-300 flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
                {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
              </div>
            ) : (
              <button
                onClick={() => { setNameDraft(profile?.username ?? ''); setEditingName(true) }}
                className="flex items-center gap-2 group">
                <h1 className="text-white font-bold text-xl truncate">{profile?.username}</h1>
                <Pencil size={13} className="text-gray-500 group-hover:text-gray-300 flex-shrink-0" />
              </button>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${partyColor}33`, color: partyColor }}>
                {partyName}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${rank.color}22`, color: rank.color }}>
                {rank.title}
              </span>
            </div>
            {cliqueName && (
              <button onClick={() => router.push('/cliques')}
                className="mt-1.5 text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
                style={{ background: `${partyColor}1a`, color: partyColor, border: `1px solid ${partyColor}44` }}>
                ✊ {cliqueName}
              </button>
            )}
          </div>
          <button onClick={() => signOut(() => router.push('/sign-in'))}
            className="p-2 text-gray-500 hover:text-gray-300">
            <LogOut size={20} />
          </button>
        </div>

        {/* Rank progress bar */}
        {nextRank && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{rank.title}</span>
              <span>{nextRank.title} in {nextRank.min - (profile?.total_battles_won || 0)} wins</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${progressToNext}%`, background: rank.color }} />
            </div>
          </div>
        )}
      </div>

      {/* Today's steps */}
      <div className="px-4 mt-2">
        <div className="bg-gray-900 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-green-500/15 flex items-center justify-center">
            <Footprints size={20} className="text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-gray-500 text-xs">Steps today · resets at midnight</p>
            <p className="text-green-400 font-black text-2xl leading-tight">{(todaySteps ?? 0).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-600 text-[10px]">Earns FP as you walk</p>
            <p className="text-gray-400 text-xs">10 FP / 500 steps</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="px-4 mt-3">
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Zap size={18} className="text-yellow-400" />,    label: 'Fighting Points', value: profile?.fp_balance?.toLocaleString() || '0',        color: 'text-yellow-400' },
            { icon: <Footprints size={18} className="text-green-400" />, label: 'Total Steps',  value: profile?.total_steps?.toLocaleString() || '0',         color: 'text-green-400' },
            { icon: <Swords size={18} className="text-blue-400" />,   label: 'Battles Won',    value: profile?.total_battles_won?.toLocaleString() || '0',    color: 'text-blue-400' },
            { icon: <Flag size={18} className="text-purple-400" />,   label: 'Halls Captured', value: profile?.total_gyms_captured?.toLocaleString() || '0', color: 'text-purple-400' },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="bg-gray-900 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                {icon}
                <span className="text-gray-500 text-xs">{label}</span>
              </div>
              <div className={`font-bold text-2xl ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Battle record summary */}
      <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Battle Record</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-center">
            <div className="text-green-400 font-bold text-2xl">{profile?.total_battles_won || 0}</div>
            <div className="text-gray-500 text-xs">Wins</div>
          </div>
          <div className="text-gray-700 font-bold text-xl">/</div>
          <div className="flex-1 text-center">
            <div className="text-red-400 font-bold text-2xl">{profile?.total_battles_lost || 0}</div>
            <div className="text-gray-500 text-xs">Losses</div>
          </div>
          <div className="text-gray-700 font-bold text-xl">/</div>
          <div className="flex-1 text-center">
            <div className="text-gray-400 font-bold text-2xl">{winRate}%</div>
            <div className="text-gray-500 text-xs">Win Rate</div>
          </div>
        </div>
      </div>

      {/* Recent battles */}
      <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Recent Battles</h3>
        {battlesLoading ? (
          <p className="text-gray-600 text-sm text-center py-2">Loading...</p>
        ) : battles.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-2">No battles yet — get out there!</p>
        ) : (
          <div className="space-y-2">
            {battles.map(b => {
              const resultColor = b.result === 'victory' ? '#22c55e'
                : b.result === 'defeat' ? '#ef4444' : '#6b7280'
              const resultEmoji = b.result === 'victory' ? '🏆'
                : b.result === 'defeat' ? '💀' : '🏃'
              const enemyName = ENEMY_LABELS[b.enemy_type] || b.enemy_type.replace(/_/g, ' ')
              return (
                <div key={b.id}
                  className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                  <span className="text-lg w-7 text-center flex-shrink-0">{resultEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{enemyName}</p>
                    <p className="text-gray-500 text-xs">{timeAgo(b.created_at)} · {b.fp_spent} FP spent</p>
                  </div>
                  <span className="text-xs font-bold capitalize px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: resultColor, background: `${resultColor}18`, border: `1px solid ${resultColor}44` }}>
                    {b.result}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="mx-4 mt-3 space-y-2">
        <button onClick={() => router.push('/fighter')}
          className="w-full py-3 bg-gray-900 border border-red-900 rounded-xl text-red-400 text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          🥊 Design My Fighter
        </button>
        <button onClick={() => router.push('/collection')}
          className="w-full py-3 bg-gray-900 border border-yellow-900 rounded-xl text-yellow-400 text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          🎯 My Collection ({profile?.total_captures || 0} caught)
        </button>
        <button onClick={() => router.push('/leaderboard')}
          className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-white text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          🏆 Leaderboard
        </button>
        <button onClick={() => router.push('/shop')}
          className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-white text-sm flex items-center justify-center gap-2 hover:bg-gray-800 transition">
          ⚡ Buy Fighting Points
        </button>
      </div>

      {/* Settings */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Settings</h3>
        <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
          {(
            [
              {
                key: 'show_party' as const,
                label: 'Show Party Affiliation',
                sub: 'Others see your party color on the map',
                val: profile?.show_party ?? true,
                onColor: '#22c55e',
              },
              {
                key: 'allow_messages' as const,
                label: 'Allow Direct Messages',
                sub: 'Other players can send you chat requests',
                val: profile?.allow_messages ?? true,
                onColor: '#3b82f6',
              },
              {
                key: 'allow_pvp_messages' as const,
                label: 'PvP Battle Chat',
                sub: 'Chat after PvP battles (both players must enable)',
                val: profile?.allow_pvp_messages ?? false,
                onColor: '#7c3aed',
              },
            ] as const
          ).map(({ key, label, sub, val, onColor }) => (
            <button
              key={key}
              onClick={() => toggleSetting(key, val)}
              disabled={toggling === key}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition border-b border-gray-800 last:border-0 disabled:opacity-50"
            >
              <div className="text-left">
                <div className="text-white text-sm font-medium">{label}</div>
                <div className="text-gray-500 text-xs">{sub}</div>
              </div>
              <div className="ml-3 flex-shrink-0 w-10 h-6 rounded-full relative transition-colors"
                style={{ background: val ? onColor : '#374151' }}>
                <div className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                  style={{ left: val ? 22 : 4 }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Blocked players */}
      <div className="mx-4 mt-3 mb-6">
        {!showBlocked ? (
          <button onClick={loadBlocked}
            className="w-full py-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-500 text-sm hover:bg-gray-800 hover:text-gray-300 transition">
            🚫 Manage Blocked Players
          </button>
        ) : (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-gray-400 text-xs uppercase tracking-wider">Blocked Players</span>
              <button onClick={() => setShowBlocked(false)} className="text-gray-600 hover:text-gray-400 text-xs">Hide</button>
            </div>
            {blockedPlayers.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-4">No blocked players</p>
            ) : blockedPlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-800 last:border-0">
                <span className="text-gray-300 text-sm">{p.username}</span>
                <button onClick={() => unblock(p.id)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition font-medium">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Posts (public feed at the bottom of the profile) ─────────────── */}
      <div className="mx-4 mt-3 mb-6">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Posts</h3>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-3 mb-3">
          <textarea
            value={postText}
            onChange={e => setPostText(e.target.value.slice(0, 500))}
            placeholder="What's happening on the trail?"
            rows={2}
            className="w-full bg-gray-800 text-white rounded-xl p-3 text-sm resize-none border border-gray-700 focus:border-gray-500 outline-none placeholder-gray-600"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-gray-600 text-xs">{postText.length}/500</span>
            <button onClick={publishPost} disabled={posting || !postText.trim()}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
              style={{ background: partyColor }}>
              {posting ? '...' : 'Post'}
            </button>
          </div>
        </div>

        {posts.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">No posts yet — say something!</p>
        ) : (
          <div className="space-y-2">
            {posts.map(p => (
              <div key={p.id} className="bg-gray-900 rounded-xl border border-gray-800 p-3">
                <div className="flex items-start gap-2">
                  <p className="text-gray-200 text-sm flex-1 whitespace-pre-wrap break-words">{p.content}</p>
                  <button onClick={() => deletePost(p.id)}
                    className="text-gray-700 hover:text-red-400 text-xs flex-shrink-0 transition">✕</button>
                </div>
                <p className="text-gray-600 text-xs mt-1.5">{timeAgo(p.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
