'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import AboutMeText from '@/components/AboutMeText'
import { Zap, Footprints, Swords, Flag, Camera, Pencil, Check, X, Plus, MessageSquare, Share2, Bell } from 'lucide-react'
import AlbumViewer from '@/components/AlbumViewer'
import { VoteButtons } from '@/components/HallFeed'

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

interface Post {
  id: string
  content: string
  created_at: string
  score: number
  my_vote: number
  media_url?: string | null
  media_type?: 'image' | 'video' | null
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

// Album photos keep their aspect ratio, just downscaled to a sane max
function resizeAlbumImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const max = 1200
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/webp', 0.85))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function ProfilePage() {
  const router = useRouter()
  const { profile, loading, refetch } = useProfile()
  const [battles, setBattles] = useState<BattleRecord[]>([])
  const [battlesLoading, setBattlesLoading] = useState(true)

  // Photo, click, posts
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cliqueName, setCliqueName] = useState<string | null>(null)
  const [cliqueGymId, setCliqueGymId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [postText, setPostText] = useState('')
  const [posting, setPosting] = useState(false)
  const [draftImage, setDraftImage] = useState<string | null>(null)   // base64 pic/gif
  const [draftVideo, setDraftVideo] = useState<{ url: string } | null>(null)
  const [mediaBusy, setMediaBusy] = useState('')
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const [sharedPost, setSharedPost] = useState('')
  const [showStats, setShowStats] = useState(false)
  const [showPhotos, setShowPhotos] = useState(false)
  // About Me editor
  const [editingAbout, setEditingAbout] = useState(false)
  const [aboutDraft, setAboutDraft] = useState('')
  const [savingAbout, setSavingAbout] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [unreadNotifs, setUnreadNotifs] = useState(0)

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => setUnreadNotifs(d.unread ?? 0))
      .catch(() => {})
  }, [])

  async function votePost(post: Post, v: number) {
    setPosts(ps => ps.map(p => p.id === post.id ? { ...p, score: (p.score ?? 0) + v - (p.my_vote ?? 0), my_vote: v } : p))
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

  function sharePost(post: Post) {
    const url = `${window.location.origin}/player/${profile?.id}`
    if (navigator.share) {
      navigator.share({ title: 'PoliticsGo', text: post.content.slice(0, 100), url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url)
    }
    setSharedPost(post.id)
    setTimeout(() => setSharedPost(''), 1500)
  }
  const [todaySteps, setTodaySteps] = useState<number | null>(null)
  // Campaign HQ (Print Shop) — production status + claim
  const [farm, setFarm] = useState<{ ready: number; cap: number; rate_hours: number; next_in_secs: number } | null>(null)
  const [farmBusy, setFarmBusy] = useState(false)
  useEffect(() => {
    fetch('/api/farm').then(r => r.json()).then(d => { if (typeof d.ready === 'number') setFarm(d) }).catch(() => {})
  }, [])
  async function claimFarm() {
    if (farmBusy) return
    setFarmBusy(true)
    try {
      const res = await fetch('/api/farm', { method: 'POST' })
      const d = await res.json()
      if (res.ok && d.claimed > 0) {
        setFarm(f => f ? { ...f, ready: 0, next_in_secs: f.rate_hours * 3600 } : f)
      }
    } catch {}
    setFarmBusy(false)
  }
  const [albumPhotos, setAlbumPhotos] = useState<{ id: string; url: string }[]>([])
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [viewerStart, setViewerStart] = useState<number | null>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(d => setPosts(d.posts ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Today's steps: prefer the live local count, fall back to the server record
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    try {
      const saved = JSON.parse(localStorage.getItem(`stepsv2_${todayStr}`) || 'null')
      if (saved) setTodaySteps(Math.max(saved.motion || 0, Math.round((saved.gpsMeters || 0) * 1.31)))
    } catch {}
    fetch('/api/steps')
      .then(r => r.json())
      .then(d => {
        const rec = (d.steps ?? []).find((s: any) => s.record_date === todayStr)
        const server = rec?.step_count ?? 0
        setTodaySteps(prev => Math.max(prev ?? 0, server))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!profile?.clique_id) { setCliqueName(null); setCliqueGymId(null); return }
    fetch(`/api/cliques/${profile.clique_id}`)
      .then(r => r.json())
      .then(d => { setCliqueName(d.clique?.name ?? null); setCliqueGymId(d.clique?.gym_id ?? null) })
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

  // Album: extra photos beyond the avatar
  useEffect(() => {
    fetch('/api/profile/photos')
      .then(r => r.json())
      .then(d => setAlbumPhotos(d.photos ?? []))
      .catch(() => {})
  }, [])

  async function addAlbumPhoto(file: File) {
    setAddingPhoto(true)
    try {
      const dataUrl = await resizeAlbumImage(file)
      const res = await fetch('/api/profile/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const d = await res.json()
      if (res.ok) setAlbumPhotos(p => [...p, d.photo])
    } catch {}
    setAddingPhoto(false)
  }

  async function deleteAlbumPhoto(id: string) {
    const res = await fetch(`/api/profile/photos?id=${id}`, { method: 'DELETE' })
    if (res.ok) setAlbumPhotos(p => p.filter(x => x.id !== id))
  }

  // The full album = avatar first, then extra photos
  const fullAlbum = [
    ...(profile?.avatar_url ? [{ id: 'avatar', url: profile.avatar_url }] : []),
    ...albumPhotos,
  ]

  // Pic/GIF: GIFs pass through (canvas would freeze them); others shrink to webp
  async function pickPhoto(file: File) {
    if (file.size > 8 * 1024 * 1024) { setMediaBusy('Image too big (max 8 MB)'); setTimeout(() => setMediaBusy(''), 2500); return }
    setDraftVideo(null)
    if (file.type === 'image/gif') {
      const reader = new FileReader()
      reader.onload = () => setDraftImage(String(reader.result))
      reader.readAsDataURL(file)
      return
    }
    const bmp = await createImageBitmap(file)
    const max = 1280, scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    setDraftImage(canvas.toDataURL('image/webp', 0.85))
  }

  // Video: get a signed URL and upload straight to storage (bypasses API limit)
  async function pickVideo(file: File) {
    if (file.size > 60 * 1024 * 1024) { setMediaBusy('Video too big (max 60 MB)'); setTimeout(() => setMediaBusy(''), 2500); return }
    setDraftImage(null); setMediaBusy('Uploading video…')
    try {
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
      const res = await fetch('/api/posts/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ext }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      const { createSupabaseBrowserClient } = await import('@/lib/supabase-client')
      const sb = createSupabaseBrowserClient()
      const { error } = await sb.storage.from('avatars').uploadToSignedUrl(d.path, d.token, file, { contentType: file.type })
      if (error) throw error
      setDraftVideo({ url: d.publicUrl })
      setMediaBusy('')
    } catch (e: any) {
      setMediaBusy(e?.message || 'Video upload failed'); setTimeout(() => setMediaBusy(''), 2500)
    }
  }

  async function publishPost() {
    if (!postText.trim() && !draftImage && !draftVideo) return
    setPosting(true)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: postText.trim(), image: draftImage, video_url: draftVideo?.url }),
      })
      const data = await res.json()
      if (data.post) {
        setPosts(prev => [data.post, ...prev])
        setPostText(''); setDraftImage(null); setDraftVideo(null)
      } else if (data.error) { setMediaBusy(data.error); setTimeout(() => setMediaBusy(''), 2500) }
    } catch {}
    setPosting(false)
  }

  async function deletePost(id: string) {
    setPosts(prev => prev.filter(p => p.id !== id))
    fetch(`/api/posts/${id}`, { method: 'DELETE' }).catch(() => {})
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
                  className="w-28 h-28 rounded-full object-cover border-4 shadow-xl"
                  style={{ borderColor: profile?.show_party === false ? '#e5e7eb' : partyColor, opacity: uploading ? 0.5 : 1 }} />
              ) : (
                <div className="w-28 h-28 rounded-full flex items-center justify-center text-5xl border-4"
                  style={{ borderColor: profile?.show_party === false ? '#e5e7eb' : partyColor, background: `${partyColor}33`, opacity: uploading ? 0.5 : 1 }}>
                  {partyEmoji}
                </div>
              )}
            </button>
            <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center pointer-events-none">
              <Camera size={14} className="text-gray-300" />
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
              <span className="mt-1.5 text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
                style={{ background: `${partyColor}1a`, color: partyColor, border: `1px solid ${partyColor}44` }}>
                {(() => {
                  const i = cliqueName.lastIndexOf(' — ')
                  const nm = i >= 0 ? cliqueName.slice(0, i) : cliqueName
                  const city = i >= 0 ? cliqueName.slice(i + 3) : null
                  return (
                    <>
                      {/* clique name → my clique's page; city → its town hall */}
                      <span role="link" onClick={() => router.push(`/cliques/${profile?.clique_id}`)}
                        className="cursor-pointer hover:underline">✊ {nm}</span>
                      {city && (
                        <>
                          <span className="opacity-60">—</span>
                          <span role="link"
                            onClick={() => cliqueGymId && router.push(`/townhall/${cliqueGymId}`)}
                            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80">
                            {city}
                          </span>
                        </>
                      )}
                    </>
                  )
                })()}
              </span>
            )}
          </div>
          {/* mt-11 clears the global menu button fixed in this corner */}
          <div className="flex flex-col gap-1 self-start mt-11">
            <button onClick={() => router.push('/notifications')}
              className="p-2 text-gray-400 hover:text-white relative" aria-label="Notifications">
              <Bell size={20} />
              {unreadNotifs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {unreadNotifs > 99 ? '99+' : unreadNotifs}
                </span>
              )}
            </button>
            <button onClick={() => router.push('/messages')}
              className="p-2 text-gray-400 hover:text-white" aria-label="Messages">
              <MessageSquare size={20} />
            </button>
          </div>
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

      {/* About Me — write something, drop links or photo URLs */}
      <div className="mx-4 mt-2 bg-gray-900 rounded-2xl px-4 py-3.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-white text-sm font-bold">💬 About Me</span>
          {!editingAbout && (
            <button onClick={() => { setAboutDraft(((profile as any)?.about_me as string) ?? ''); setEditingAbout(true) }}
              className="text-purple-400 text-xs font-bold hover:text-purple-300">
              {(profile as any)?.about_me ? '✏️ Edit' : ''}
            </button>
          )}
        </div>
        {editingAbout ? (
          <div>
            <textarea value={aboutDraft} onChange={e => setAboutDraft(e.target.value)} maxLength={600} rows={4}
              placeholder="Write something about yourself... links and photo URLs work too"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-500 resize-none" />
            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-600 text-[11px]">{aboutDraft.length}/600</span>
              <div className="flex gap-2">
                <button onClick={() => setEditingAbout(false)}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-gray-300 bg-gray-800 hover:bg-gray-700">Cancel</button>
                <button disabled={savingAbout}
                  onClick={async () => {
                    setSavingAbout(true)
                    try {
                      await fetch('/api/profile/settings', {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ about_me: aboutDraft.trim() || null }),
                      })
                      await refetch()
                      setEditingAbout(false)
                    } finally { setSavingAbout(false) }
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-purple-700 hover:bg-purple-600 disabled:opacity-50">
                  {savingAbout ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (profile as any)?.about_me ? (
          <AboutMeText text={(profile as any).about_me} />
        ) : (
          <button onClick={() => { setAboutDraft(''); setEditingAbout(true) }}
            className="w-full text-left bg-gray-800/60 border border-dashed border-gray-700 rounded-xl p-3 text-sm text-gray-500 hover:border-purple-500 hover:text-gray-400 transition">
            Write something about yourself... links and photo URLs work too
          </button>
        )}
      </div>

      {/* Photo album — collapsed behind an expandable bar; the big main
             picture above is the star */}
      <div className="mx-4 mt-2 bg-gray-900 rounded-2xl overflow-hidden">
        <button onClick={() => setShowPhotos(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-800 transition">
          <span className="text-white text-sm font-bold">📸 My Photos <span className="text-gray-500 font-normal">({fullAlbum.length}/13)</span></span>
          <span className={`text-gray-500 text-xs transition-transform ${showPhotos ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {showPhotos && (
        <div className="grid grid-cols-3 gap-2 px-3 pb-3">
          {fullAlbum.map((ph, idx) => (
            <div key={ph.id} className="relative aspect-square">
              <button onClick={() => setViewerStart(idx)}
                className="w-full h-full rounded-xl overflow-hidden border border-gray-800 active:scale-95 transition">
                <img src={ph.url} alt="" className="w-full h-full object-cover" />
              </button>
              {ph.id === 'avatar'
                ? <span className="absolute top-1 left-1 bg-black/70 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">Main</span>
                : (
                  <button onClick={() => deleteAlbumPhoto(ph.id)}
                    className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-1"><X size={11} /></button>
                )}
            </div>
          ))}
          {albumPhotos.length < 12 && (
            <button onClick={() => albumInputRef.current?.click()} disabled={addingPhoto}
              className="aspect-square rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-gray-500 hover:text-gray-300 transition disabled:opacity-50">
              {addingPhoto ? <span className="text-xs">...</span> : <><Plus size={22} /><span className="text-[10px] mt-0.5">Add photo</span></>}
            </button>
          )}
        </div>
        )}
        <input ref={albumInputRef} type="file" accept="image/*" hidden
          onChange={e => e.target.files?.[0] && addAlbumPhoto(e.target.files[0])} />
      </div>

      {/* Today's steps — tap opens the Step Tracker */}
      <div className="px-4 mt-3">
        <button onClick={() => router.push('/steps')}
          className="w-full bg-gray-900 rounded-2xl p-4 flex items-center gap-3 text-left hover:bg-gray-800 active:scale-[0.99] transition">
          <div className="w-11 h-11 rounded-full bg-green-500/15 flex items-center justify-center">
            <Footprints size={20} className="text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-gray-500 text-xs">Steps today · tap for your Step Tracker</p>
            <p className="text-green-400 font-black text-2xl leading-tight">{(todaySteps ?? 0).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-600 text-[10px]">Streaks · milestones · history</p>
            <p className="text-gray-400 text-xs">100 FP / 150 steps ›</p>
          </div>
        </button>
      </div>

      {/* Campaign HQ — the Print Shop farm (siege rework B4): slowly prints
          siege firecrackers; claim adds them to the bag */}
      <div className="px-4 mt-3">
        <div className="w-full bg-gray-900 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-500/15 flex items-center justify-center text-xl">🖨️</div>
          <div className="flex-1 min-w-0">
            <p className="text-gray-500 text-xs">Campaign HQ · Print Shop</p>
            {farm === null ? (
              <p className="text-gray-500 text-sm font-bold">Loading…</p>
            ) : farm.ready > 0 ? (
              <p className="text-amber-300 font-black text-lg leading-tight">🧨 {farm.ready} firecracker{farm.ready === 1 ? '' : 's'} ready</p>
            ) : (
              <p className="text-gray-400 text-sm font-bold">Printing… next 🧨 in {Math.max(1, Math.ceil((farm.next_in_secs ?? 0) / 60))} min</p>
            )}
            <p className="text-gray-600 text-[10px]">1 every {farm?.rate_hours ?? 2}h · holds {farm?.cap ?? 10}</p>
          </div>
          <button onClick={claimFarm} disabled={!farm || farm.ready <= 0 || farmBusy}
            className="px-4 py-2.5 rounded-xl font-black text-sm text-black transition active:scale-95 disabled:opacity-35"
            style={{ background: 'linear-gradient(135deg,#fbbf24,#d97706)' }}>
            {farmBusy ? '…' : 'CLAIM'}
          </button>
        </div>
      </div>

      {/* My Friends — private list, only you can see it */}
      <div className="px-4 mt-3">
        <button onClick={() => router.push('/friends')}
          className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
          👥 My Friends
        </button>
      </div>

      {/* Stats + battle record — collapsed into an expandable bar */}
      <div className="mx-4 mt-3 bg-gray-900 rounded-2xl overflow-hidden">
        <button onClick={() => setShowStats(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-800 transition">
          <span className="text-white text-sm font-bold">📊 My Stats & Battle Record</span>
          <span className={`text-gray-500 text-xs transition-transform ${showStats ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {showStats && (
          <div className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: <Zap size={18} className="text-yellow-400" />,    label: 'Fighting Points', value: profile?.fp_balance?.toLocaleString() || '0',        color: 'text-yellow-400' },
                { icon: <Footprints size={18} className="text-green-400" />, label: 'Total Steps',  value: profile?.total_steps?.toLocaleString() || '0',         color: 'text-green-400' },
                { icon: <Swords size={18} className="text-blue-400" />,   label: 'Battles Won',    value: profile?.total_battles_won?.toLocaleString() || '0',    color: 'text-blue-400' },
                { icon: <Flag size={18} className="text-purple-400" />,   label: 'Halls Captured', value: profile?.total_gyms_captured?.toLocaleString() || '0', color: 'text-purple-400' },
              ].map(({ icon, label, value, color }) => (
                <div key={label} className="bg-gray-800/60 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    {icon}
                    <span className="text-gray-500 text-xs">{label}</span>
                  </div>
                  <div className={`font-bold text-xl ${color}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 mt-2 flex items-center gap-3">
              <div className="flex-1 text-center">
                <div className="text-green-400 font-bold text-xl">{profile?.total_battles_won || 0}</div>
                <div className="text-gray-500 text-xs">Wins</div>
              </div>
              <div className="text-gray-700 font-bold text-xl">/</div>
              <div className="flex-1 text-center">
                <div className="text-red-400 font-bold text-xl">{profile?.total_battles_lost || 0}</div>
                <div className="text-gray-500 text-xs">Losses</div>
              </div>
              <div className="text-gray-700 font-bold text-xl">/</div>
              <div className="flex-1 text-center">
                <div className="text-gray-400 font-bold text-xl">{winRate}%</div>
                <div className="text-gray-500 text-xs">Win Rate</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent battles — expandable bar */}
      <div className="mx-4 mt-3 bg-gray-900 rounded-2xl overflow-hidden">
        <button onClick={() => setShowRecent(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-800 transition">
          <span className="text-white text-sm font-bold">⚔️ Recent Battles</span>
          <span className={`text-gray-500 text-xs transition-transform ${showRecent ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {showRecent && (
        <div className="px-4 pb-4">
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
          {/* media preview */}
          {draftImage && (
            <div className="relative mt-2 inline-block">
              <img src={draftImage} alt="" className="max-h-48 rounded-xl border border-gray-700" />
              <button onClick={() => setDraftImage(null)} className="absolute -top-2 -right-2 bg-gray-800 border border-gray-600 rounded-full p-1 text-white"><X size={12} /></button>
            </div>
          )}
          {draftVideo && (
            <div className="relative mt-2">
              <video src={draftVideo.url} className="max-h-48 rounded-xl border border-gray-700" controls playsInline />
              <button onClick={() => setDraftVideo(null)} className="absolute top-1 right-1 bg-black/70 rounded-full p-1 text-white"><X size={12} /></button>
            </div>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={e => { e.target.files?.[0] && pickPhoto(e.target.files[0]); e.target.value = '' }} />
          <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={e => { e.target.files?.[0] && pickVideo(e.target.files[0]); e.target.value = '' }} />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => photoInputRef.current?.click()} disabled={!!mediaBusy}
              className="flex items-center gap-1 text-gray-300 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition disabled:opacity-50">
              <Camera size={14} /> Photo / GIF
            </button>
            <button onClick={() => videoInputRef.current?.click()} disabled={!!mediaBusy}
              className="flex items-center gap-1 text-gray-300 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition disabled:opacity-50">
              🎥 Video
            </button>
            {mediaBusy && <span className="text-purple-300 text-[11px]">{mediaBusy}</span>}
            <span className="text-gray-600 text-xs ml-auto">{postText.length}/500</span>
            <button onClick={publishPost} disabled={posting || !!mediaBusy || (!postText.trim() && !draftImage && !draftVideo)}
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
                {p.media_type === 'image' && p.media_url && (
                  <img src={p.media_url} alt="" className="rounded-xl mt-2 w-full max-h-80 object-cover border border-gray-800" />
                )}
                {p.media_type === 'video' && p.media_url && (
                  <video src={p.media_url} className="rounded-xl mt-2 w-full max-h-80 border border-gray-800" controls playsInline preload="metadata" />
                )}
                <div className="flex items-center gap-3 mt-2">
                  <VoteButtons compact score={p.score ?? 0} myVote={p.my_vote ?? 0} onVote={v => votePost(p, v)} />
                  <button onClick={() => sharePost(p)}
                    className="flex items-center gap-1 text-gray-500 hover:text-green-400 transition">
                    <Share2 size={14} />
                    <span className="text-[11px] font-bold">{sharedPost === p.id ? 'Copied!' : 'Share'}</span>
                  </button>
                  <span className="text-gray-600 text-xs ml-auto">{timeAgo(p.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewerStart !== null && (
        <AlbumViewer photos={fullAlbum} start={viewerStart} title="My Photos" onClose={() => setViewerStart(null)} />
      )}
    </div>
  )
}
