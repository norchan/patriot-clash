'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Share, Swords, MessageSquare, BarChart3, UserPlus, UserCheck, Info } from 'lucide-react'
import AlbumViewer from '@/components/AlbumViewer'
import AboutMeText from '@/components/AboutMeText'
import { VoteButtons } from '@/components/HallFeed'
import { useLocation } from '@/hooks/useLocation'
import { useProfile } from '@/hooks/useProfile'

interface PublicProfile {
  id: string
  username: string
  party: 'democrat' | 'republican' | null
  avatar_url: string | null
  about_me?: string | null
  total_battles_won: number
  total_battles_lost: number
  total_gyms_captured: number
  total_captures: number
}

interface Clique { id: string; name: string; party: string; gym_id: string | null }
interface Post { id: string; content: string; created_at: string; score: number; my_vote: number; media_url?: string | null; media_type?: 'image' | 'video' | null }

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function PublicProfilePage() {
  const router = useRouter()
  const params = useParams()
  const { location } = useLocation()
  const { profile: viewer } = useProfile()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [clique, setClique] = useState<Clique | null>(null)
  const [playerLoc, setPlayerLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [challenging, setChallenging] = useState(false)
  const [challengeMsg, setChallengeMsg] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([])
  const [viewerOpen, setViewerOpen] = useState(false)
  const [shared, setShared] = useState('')
  const [statsOpen, setStatsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  // friend status with this player — PRIVATE: only the pair relationship,
  // never lists or counts
  const [friendStatus, setFriendStatus] = useState<'none' | 'friends' | 'pending_in' | 'pending_out' | null>(null)
  const [friendBusy, setFriendBusy] = useState(false)

  useEffect(() => {
    const id = params.id as string
    if (!id || viewer?.id === id) return
    fetch(`/api/friends?with=${id}`).then(r => r.json())
      .then(d => setFriendStatus(d.status ?? 'none')).catch(() => setFriendStatus('none'))
  }, [params.id, viewer?.id])

  async function addFriend() {
    if (!profile || friendBusy) return
    setFriendBusy(true)
    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id }),
      })
      const d = await res.json()
      if (res.ok) setFriendStatus(d.status)
    } catch {}
    setFriendBusy(false)
  }

  async function votePost(post: Post, v: number) {
    setPosts(ps => ps.map(p => p.id === post.id ? { ...p, score: p.score + v - p.my_vote, my_vote: v } : p))
    try {
      const res = await fetch('/api/posts/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'profile', post_id: post.id, vote: v }),
      })
      const d = await res.json()
      if (res.ok) setPosts(ps => ps.map(p => p.id === post.id ? { ...p, score: d.score, my_vote: d.my_vote } : p))
    } catch {}
  }

  async function challenge() {
    if (!profile || challenging) return
    setChallenging(true)
    setChallengeMsg('')
    try {
      const res = await fetch('/api/pvp/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defender_id: profile.id }),
      })
      const d = await res.json()
      if (res.ok && (d.status === 'accepted' || d.status === 'completed')) {
        router.push(`/battle/pvp?id=${d.id}`)
        return
      } else if (res.ok) {
        setChallengeMsg(`⚔️ Challenge sent to ${profile.username}!`)
      } else {
        setChallengeMsg(`❌ ${d.error ?? d.message ?? 'Could not challenge'}`)
      }
    } catch { setChallengeMsg('❌ Could not challenge') }
    setChallenging(false)
  }

  function sharePost(post: Post) {
    const url = `${window.location.origin}/player/${params.id}`
    if (navigator.share) {
      navigator.share({ title: 'PoliticsGo', text: post.content.slice(0, 100), url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url)
    }
    setShared(post.id)
    setTimeout(() => setShared(''), 1500)
  }

  useEffect(() => {
    // Pass our location so a garrison bot shows the clique of the town hall
    // we're viewing it near (bots appear at many halls).
    const loc = location ? `?lat=${location.lat}&lng=${location.lng}` : ''
    fetch(`/api/players/${params.id}/profile${loc}`)
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setProfile(d.profile)
          setClique(d.clique)
          setPlayerLoc(d.location ? { lat: d.location.lat, lng: d.location.lng } : null)
          setPosts(d.posts ?? [])
          setPhotos(Array.isArray(d.photos) && d.photos.length
            ? d.photos
            : d.profile.avatar_url ? [{ id: 'avatar', url: d.profile.avatar_url }] : [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [params.id, location?.lat, location?.lng])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Loading profile...</div>
    </div>
  )

  if (!profile) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="text-4xl mb-4">👤</div>
      <p className="text-gray-400">Player not found.</p>
      <button onClick={() => router.back()} className="mt-4 text-blue-400">← Back</button>
    </div>
  )

  const partyColor = profile.party === 'democrat' ? '#2563eb'
    : profile.party === 'republican' ? '#dc2626' : '#9ca3af'
  const partyEmoji = profile.party === 'democrat' ? '🔵'
    : profile.party === 'republican' ? '🔴' : '⚪'
  const partyName = profile.party === 'democrat' ? 'Democrat'
    : profile.party === 'republican' ? 'Republican' : 'Affiliation hidden'
  const cliquePartyColor = clique?.party === 'democrat' ? '#2563eb' : '#dc2626'
  const winRate = profile.total_battles_won + profile.total_battles_lost > 0
    ? Math.round(profile.total_battles_won / (profile.total_battles_won + profile.total_battles_lost) * 100)
    : 0

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      {/* Hero */}
      <div className="px-4 pt-4 pb-6"
        style={{ background: `linear-gradient(180deg, ${partyColor}26 0%, transparent 100%)` }}>
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 mb-4 hover:text-white">
          <ArrowLeft size={16} /><span className="text-sm">Back</span>
        </button>
        <div className="flex flex-col items-center text-center">
          {profile.avatar_url ? (
            <button onClick={() => setViewerOpen(true)}
              className="relative active:scale-[0.98] transition"
              aria-label="View photo fullscreen">
              <img src={profile.avatar_url} alt={profile.username}
                className="w-44 h-44 rounded-3xl object-cover border-4 shadow-2xl"
                style={{ borderColor: partyColor, boxShadow: `0 10px 40px ${partyColor}44` }} />
            </button>
          ) : (
            <div className="w-44 h-44 rounded-3xl flex items-center justify-center text-7xl border-4"
              style={{ borderColor: partyColor, background: `${partyColor}33` }}>
              {partyEmoji}
            </div>
          )}
          <h1 className="text-white font-bold text-2xl mt-3">{profile.username}</h1>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: `${partyColor}33`, color: partyColor }}>
              {partyName}
            </span>
            {playerLoc && location && (
              <button onClick={() => router.push(`/map?flat=${playerLoc.lat}&flng=${playerLoc.lng}`)}
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: '#10b98133', color: '#10b981' }}>
                📍 {(() => {
                  const R = 3959
                  const φ1 = (location.lat * Math.PI) / 180
                  const φ2 = (playerLoc.lat * Math.PI) / 180
                  const Δφ = ((playerLoc.lat - location.lat) * Math.PI) / 180
                  const Δλ = ((playerLoc.lng - location.lng) * Math.PI) / 180
                  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
                  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
                  const distance = R * c
                  return distance < 0.5 ? 'exact' : `~${Math.round(distance)} mi`
                })()}
              </button>
            )}
          </div>
          {clique && (
            <div className="mt-2">
              <span className="text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1"
                style={{ background: `${cliquePartyColor}1a`, color: cliquePartyColor, border: `1px solid ${cliquePartyColor}44` }}>
                {(() => {
                  const i = clique.name.lastIndexOf(' — ')
                  const nm = i >= 0 ? clique.name.slice(0, i) : clique.name
                  const city = i >= 0 ? clique.name.slice(i + 3) : null
                  return (
                    <>
                      {/* clique name → its page (join if same party, limited
                          view for rivals); city → its town hall */}
                      <span role="link" onClick={() => router.push(`/cliques/${clique.id}`)}
                        className="cursor-pointer hover:underline">✊ {nm}</span>
                      {city && (
                        <>
                          <span className="opacity-60">—</span>
                          <span role="link"
                            onClick={() => clique.gym_id && router.push(`/townhall/${clique.gym_id}`)}
                            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80">
                            {city}
                          </span>
                        </>
                      )}
                      <span className="opacity-70">· {clique.party === 'democrat' ? 'Democrat' : 'Republican'} Clique</span>
                    </>
                  )
                })()}
              </span>
            </div>
          )}
          <div className="mt-4 w-full max-w-xs space-y-2">
            {/* About Me — shown when the player wrote one, right above Challenge */}
            {profile.about_me && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 text-left">
                <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider mb-1">About Me</p>
                <AboutMeText text={profile.about_me} />
              </div>
            )}
            {/* Icon row (Michael): the old buttons, as icons under About Me —
                Fight · Message · Friend · Map · Stats. Stats expands inline. */}
            <div className={`grid ${viewer?.id !== profile.id ? 'grid-cols-5' : 'grid-cols-1'} gap-1.5`}>
              {viewer?.id !== profile.id && (
                <>
                  <button onClick={challenge}
                    disabled={challenging || (viewer ? viewer.fp_balance < 50 : false)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl border bg-gray-900 border-gray-800 text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40">
                    <Swords size={19} />
                    <span className="text-[10px] font-bold">{challenging ? '…' : 'Fight'}</span>
                  </button>
                  <button onClick={() => router.push(`/messages/${profile.id}`)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl border bg-gray-900 border-gray-800 text-gray-300 hover:text-white transition active:scale-95">
                    <MessageSquare size={19} />
                    <span className="text-[10px] font-bold">Message</span>
                  </button>
                  {/* Friend — cross-party welcome; only ever shows YOUR status with them */}
                  <button onClick={friendStatus === 'none' || friendStatus === 'pending_in' ? addFriend : undefined}
                    disabled={friendBusy || friendStatus === null || friendStatus === 'friends' || friendStatus === 'pending_out'}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition active:scale-95 ${friendStatus === 'friends'
                      ? 'bg-green-900/30 border-green-800 text-green-400'
                      : 'bg-gray-900 border-gray-800 text-gray-300 hover:text-white disabled:opacity-40'}`}>
                    {friendStatus === 'friends' ? <UserCheck size={19} /> : <UserPlus size={19} />}
                    <span className="text-[10px] font-bold">
                      {friendStatus === 'friends' ? 'Friends'
                        : friendStatus === 'pending_out' ? 'Sent'
                        : friendStatus === 'pending_in' ? 'Accept'
                        : friendBusy ? '…' : 'Friend'}
                    </span>
                  </button>
                  <button onClick={() => setAboutOpen(o => !o)}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition active:scale-95 ${aboutOpen
                      ? 'bg-purple-900/40 border-purple-600 text-purple-300'
                      : 'bg-gray-900 border-gray-800 text-gray-300 hover:text-white'}`}>
                    <Info size={19} />
                    <span className="text-[10px] font-bold">About</span>
                  </button>
                </>
              )}
              <button onClick={() => setStatsOpen(o => !o)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition active:scale-95 ${statsOpen
                  ? 'bg-purple-900/40 border-purple-600 text-purple-300'
                  : 'bg-gray-900 border-gray-800 text-gray-300 hover:text-white'}`}>
                <BarChart3 size={19} />
                <span className="text-[10px] font-bold">Stats</span>
              </button>
            </div>
            {challengeMsg && <p className="text-xs text-center text-gray-300">{challengeMsg}</p>}
            {viewer && viewer.id !== profile.id && viewer.fp_balance < 50 && (
              <p className="text-red-400 text-[11px] text-center">Need 50 FP to challenge</p>
            )}
            {statsOpen && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { label: 'Battles Won', value: profile.total_battles_won },
                  { label: 'Win Rate', value: `${winRate}%` },
                  { label: 'Halls Captured', value: profile.total_gyms_captured },
                  { label: 'Characters Caught', value: profile.total_captures },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-900 rounded-xl p-3 text-left">
                    <p className="text-gray-500 text-xs mb-1">{label}</p>
                    <p className="text-white font-bold text-xl">{value}</p>
                  </div>
                ))}
              </div>
            )}
            {aboutOpen && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden pt-1">
                {profile.about_me && (
                  <div className="px-3 py-2">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">💬 About</p>
                    <AboutMeText text={profile.about_me} />
                  </div>
                )}
                {photos.length > 0 && (
                  <div className="px-3 py-2">
                    <button onClick={() => setViewerOpen(true)}
                      className="flex items-center gap-2 w-full text-left hover:opacity-80">
                      <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex-1">📸 Photos ({photos.length})</span>
                      <span className="text-gray-600 text-xs">›</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen photo viewer (avatar + any extra album photos) */}
      {viewerOpen && photos.length > 0 && (
        <AlbumViewer photos={photos} title={profile.username} onClose={() => setViewerOpen(false)} />
      )}

      {/* Posts — friends only (Michael): non-friends see a locked notice */}
      <div className="mx-4 mt-4">
        <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2 px-1">Posts</h3>
        {viewer?.id !== profile.id && friendStatus !== 'friends' ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-6 text-center">
            <p className="text-gray-400 text-sm font-bold">🔒 Only friends can see the feed</p>
            <p className="text-gray-600 text-xs mt-1">Add {profile.username} as a friend to unlock their posts.</p>
          </div>
        ) : posts.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">No posts yet.</p>
        ) : (
          <div className="space-y-2">
            {posts.map(p => (
              <Link key={p.id} href={`/player/${params.id}/post/${p.id}`}>
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 hover:border-gray-700 hover:bg-gray-800/50 transition cursor-pointer">
                  {p.content && <p className="text-gray-200 text-sm whitespace-pre-wrap break-words">{p.content}</p>}
                  {p.media_type === 'image' && p.media_url && (
                    <img src={p.media_url} alt="" className="rounded-xl mt-2 w-full max-h-80 object-cover border border-gray-800" />
                  )}
                  {p.media_type === 'video' && p.media_url && (
                    <video src={p.media_url} className="rounded-xl mt-2 w-full max-h-80 border border-gray-800" controls playsInline preload="metadata" />
                  )}
                  <div className="flex items-center gap-4 mt-2">
                    <VoteButtons compact score={p.score} myVote={p.my_vote} onVote={v => votePost(p, v)} />
                    <button onClick={(e) => { e.preventDefault(); sharePost(p); }}
                      className="flex items-center gap-1 text-gray-500 hover:text-green-400 transition">
                      <Share size={14} />
                      <span className="text-[11px] font-bold">{shared === p.id ? 'Copied!' : 'Share'}</span>
                    </button>
                    <span className="text-gray-600 text-xs ml-auto">{timeAgo(p.created_at)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
