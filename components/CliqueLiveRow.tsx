'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import CliqueFeed from '@/components/CliqueFeed'

// CLIQUE LIVE ROW (Michael 2026-07-25): the Zoom/Twitch/Kick strip.
// Always-visible horizontal scroll of member squares (avatar, name below,
// online dot upper-left: green = on a clique page right now, hollow = not).
// Tap avatar/name → profile. Your own square offers GO LIVE (screen or
// camera). Live feeds replace the avatar in the square; hover a feed → ⤢
// expands to fullscreen theatre. Creator/mods get a 🔨 menu (bans, mod).
//
// Video is browser-to-browser WebRTC in a mesh, signaled over the Supabase
// realtime channel — fine for clique-sized rooms; no media server involved.

export interface RowMember {
  id: string
  username: string
  avatar_url: string | null
  pow_wow_guest?: boolean
  is_moderator?: boolean
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

export default function CliqueLiveRow({ cliqueId, cliqueName, members, myId, creatorId, isCreator, amModerator, canGoLive, partyColor, chatReadOnly = false, onChanged }: {
  cliqueId: string
  cliqueName?: string
  members: RowMember[]
  myId: string | null
  creatorId: string
  isCreator: boolean
  amModerator: boolean
  canGoLive: boolean
  partyColor: string
  chatReadOnly?: boolean
  onChanged?: () => void
}) {
  const router = useRouter()
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [goLiveOpen, setGoLiveOpen] = useState(false)
  const [theatreId, setTheatreId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [modMenuId, setModMenuId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // per-viewer audio: feeds start muted; the 🔇 toggle unmutes who you want
  const [unmuted, setUnmuted] = useState<Set<string>>(new Set())
  const [shared, setShared] = useState(false)

  const channelRef = useRef<any>(null)
  const localRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map()) // 'out:viewerId' | 'in:broadcasterId'
  const wantedRef = useRef<Set<string>>(new Set())

  localRef.current = localStream

  const send = useCallback((payload: any) => {
    channelRef.current?.send({ type: 'broadcast', event: 'rtc', payload })
  }, [])

  const closePc = useCallback((key: string) => {
    const pc = pcsRef.current.get(key)
    if (pc) { try { pc.close() } catch {} ; pcsRef.current.delete(key) }
  }, [])

  // ── signaling + presence channel ──────────────────────────────────────────
  useEffect(() => {
    if (!myId) return
    const supabase = createSupabaseBrowserClient()
    const ch = supabase.channel(`clique-live:${cliqueId}`, {
      config: { presence: { key: myId }, broadcast: { self: false } },
    })
    channelRef.current = ch

    const syncPresence = () => {
      const state = ch.presenceState() as Record<string, Array<{ live?: boolean }>>
      const on = new Set<string>()
      const live = new Set<string>()
      for (const [key, metas] of Object.entries(state)) {
        on.add(key)
        if (metas.some(m => m.live)) live.add(key)
      }
      setOnline(on)
      setLiveIds(live)
      // drop viewers of broadcasters who went offline/stopped
      setRemoteStreams(prev => {
        const next = { ...prev }
        for (const id of Object.keys(next)) {
          if (!live.has(id)) { delete next[id]; closePc(`in:${id}`); wantedRef.current.delete(id) }
        }
        return next
      })
      setTheatreId(t => (t && t !== myId && !live.has(t)) ? null : t)
    }

    ch.on('presence', { event: 'sync' }, syncPresence)

    ch.on('broadcast', { event: 'rtc' }, async ({ payload }: any) => {
      if (!payload || payload.to !== myId) return
      const { kind, b, v } = payload // b = broadcaster id, v = viewer id
      try {
        if (kind === 'want' && b === myId && localRef.current) {
          // a viewer wants MY stream → make them a connection + offer
          const key = `out:${v}`
          closePc(key)
          const pc = new RTCPeerConnection(RTC_CONFIG)
          pcsRef.current.set(key, pc)
          localRef.current.getTracks().forEach(t => pc.addTrack(t, localRef.current!))
          pc.onicecandidate = e => { if (e.candidate) send({ kind: 'ice', b, v, to: v, cand: e.candidate.toJSON() }) }
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          send({ kind: 'offer', b, v, to: v, sdp: pc.localDescription })
        } else if (kind === 'offer' && v === myId) {
          const key = `in:${b}`
          closePc(key)
          const pc = new RTCPeerConnection(RTC_CONFIG)
          pcsRef.current.set(key, pc)
          pc.ontrack = e => setRemoteStreams(prev => ({ ...prev, [b]: e.streams[0] }))
          pc.onicecandidate = e => { if (e.candidate) send({ kind: 'ice', b, v, to: b, cand: e.candidate.toJSON() }) }
          await pc.setRemoteDescription(payload.sdp)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          send({ kind: 'answer', b, v, to: b, sdp: pc.localDescription })
        } else if (kind === 'answer' && b === myId) {
          await pcsRef.current.get(`out:${v}`)?.setRemoteDescription(payload.sdp)
        } else if (kind === 'ice') {
          const key = b === myId ? `out:${v}` : `in:${b}`
          await pcsRef.current.get(key)?.addIceCandidate(payload.cand)
        }
      } catch (err) { console.error('clique-live rtc error:', err) }
    })

    ch.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') await ch.track({ live: false })
    })

    return () => {
      for (const key of Array.from(pcsRef.current.keys())) closePc(key)
      localRef.current?.getTracks().forEach(t => t.stop())
      supabase.removeChannel(ch)
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliqueId, myId])

  // ── viewer side: request streams from anyone who's live ──────────────────
  useEffect(() => {
    if (!myId) return
    for (const b of liveIds) {
      if (b === myId || wantedRef.current.has(b)) continue
      wantedRef.current.add(b)
      send({ kind: 'want', b, v: myId, to: b })
    }
  }, [liveIds, myId, send])

  // ── go live / stop ────────────────────────────────────────────────────────
  async function goLive(kind: 'screen' | 'camera') {
    setGoLiveOpen(false)
    try {
      const stream = kind === 'screen'
        ? await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540 }, audio: true })
      setLocalStream(stream)
      localRef.current = stream
      // browser "stop sharing" bar ends the stream → clean up
      stream.getVideoTracks()[0]?.addEventListener('ended', stopLive)
      await channelRef.current?.track({ live: true })
    } catch { /* user cancelled the picker */ }
  }

  function stopLive() {
    localRef.current?.getTracks().forEach(t => t.stop())
    setLocalStream(null)
    localRef.current = null
    for (const key of Array.from(pcsRef.current.keys())) if (key.startsWith('out:')) closePc(key)
    channelRef.current?.track({ live: false })
    setTheatreId(t => (t === myId ? null : t))
  }

  // ── mod actions ───────────────────────────────────────────────────────────
  async function ban(profileId: string, duration: '24h' | '1w' | 'perma') {
    setBusy(true)
    try {
      await fetch(`/api/cliques/${cliqueId}/ban`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, duration }),
      })
      onChanged?.()
    } catch {}
    setBusy(false)
    setModMenuId(null)
  }

  async function setMod(profileId: string, add: boolean) {
    setBusy(true)
    try {
      await fetch(`/api/cliques/${cliqueId}/moderators`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, action: add ? 'add' : 'remove' }),
      })
      onChanged?.()
    } catch {}
    setBusy(false)
    setModMenuId(null)
  }

  const streamFor = (id: string): MediaStream | null =>
    id === myId ? localStream : (remoteStreams[id] ?? null)

  function toggleMute(id: string) {
    setUnmuted(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // share the live room — pow-wow-style invite naming the broadcaster
  async function shareLive(username?: string) {
    const url = `${window.location.origin}/cliques/${cliqueId}`
    const msg = `🔴 ${username ?? 'Someone'} is LIVE at ${cliqueName ?? 'our clique'} on PoliticsGo — come watch!`
    try {
      if (navigator.share) await navigator.share({ title: 'PoliticsGo', text: msg, url })
      else { await navigator.clipboard.writeText(`${msg} ${url}`); setShared(true); setTimeout(() => setShared(false), 1800) }
    } catch { /* share sheet closed */ }
  }

  const attach = (stream: MediaStream | null) => (el: HTMLVideoElement | null) => {
    if (el && stream && el.srcObject !== stream) el.srcObject = stream
  }

  const theatreMember = theatreId ? members.find(m => m.id === theatreId) : null
  const theatreStream = theatreId ? streamFor(theatreId) : null

  // leaving theatre always clears fullscreen too
  useEffect(() => { if (!theatreId) setFullscreen(false) }, [theatreId])

  // Esc backs out one level: fullscreen → theatre → closed
  useEffect(() => {
    if (!theatreId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setFullscreen(f => { if (f) return false; setTheatreId(null); return f })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theatreId])

  // THE STRIP — rendered inline on the page AND inside theatre mode
  const strip = (
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {members.map(m => {
          const isMe = m.id === myId
          const live = liveIds.has(m.id) && !!streamFor(m.id)
          const canModThis = amModerator && !isMe && m.id !== creatorId && (isCreator || !m.is_moderator)
          return (
            <div key={m.id} className="shrink-0 w-20">
              <div className="relative w-20 h-20 rounded-xl overflow-hidden border bg-gray-800 group"
                style={{ borderColor: live ? '#ef4444' : '#374151' }}>
                {live ? (
                  <video ref={attach(streamFor(m.id))} autoPlay playsInline
                    muted={isMe || !unmuted.has(m.id)}
                    className="w-full h-full object-cover" />
                ) : m.avatar_url ? (
                  <button onClick={() => router.push(`/player/${m.id}`)} className="w-full h-full">
                    <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <button onClick={() => router.push(`/player/${m.id}`)}
                    className="w-full h-full flex items-center justify-center text-2xl font-black text-white"
                    style={{ background: `${partyColor}44` }}>
                    {m.username[0]?.toUpperCase()}
                  </button>
                )}

                {/* online dot — green solid = online, hollow = offline */}
                <span className={`absolute top-1 left-1 w-3 h-3 rounded-full z-10 ${
                  online.has(m.id) ? 'bg-green-400 border border-green-200' : 'bg-transparent border-2 border-gray-400'}`} />

                {/* LIVE badge */}
                {live && (
                  <span className="absolute bottom-1 left-1 z-10 text-[8px] font-black px-1 py-px rounded bg-red-600 text-white">LIVE</span>
                )}

                {/* upper-right controls: mute toggle (members + non-members
                    alike) and the theatre expand on hover */}
                {live && (
                  <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
                    {!isMe && (
                      <button onClick={() => toggleMute(m.id)}
                        className="p-1 rounded bg-black/60 text-white text-[11px] leading-none"
                        aria-label={unmuted.has(m.id) ? 'Mute' : 'Unmute'}
                        title={unmuted.has(m.id) ? 'Mute' : 'Unmute'}>
                        {unmuted.has(m.id) ? '🔊' : '🔇'}
                      </button>
                    )}
                    <button onClick={() => setTheatreId(m.id)}
                      className="p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
                      aria-label="Theatre mode">⤢</button>
                  </div>
                )}

                {/* my square: GO LIVE / STOP */}
                {isMe && canGoLive && !live && (
                  <button onClick={() => setGoLiveOpen(true)}
                    className="absolute inset-x-0 bottom-0 z-10 py-1 text-[9px] font-black text-white bg-red-600/90 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    🔴 GO LIVE
                  </button>
                )}
                {isMe && live && (
                  <button onClick={stopLive}
                    className="absolute inset-x-0 bottom-0 z-10 py-1 text-[9px] font-black text-white bg-gray-900/90">
                    ⏹ STOP
                  </button>
                )}

                {/* mod hammer */}
                {canModThis && (
                  <button onClick={() => setModMenuId(v => v === m.id ? null : m.id)}
                    className="absolute bottom-1 right-1 z-10 p-0.5 rounded bg-black/60 text-[10px] opacity-60 hover:opacity-100 transition"
                    aria-label="Moderate">🔨</button>
                )}
              </div>

              {/* name (→ profile) + tags */}
              <button onClick={() => router.push(`/player/${m.id}`)}
                className="mt-1 w-20 text-[11px] font-bold text-gray-300 hover:text-white truncate block text-center">
                {m.id === creatorId ? '👑 ' : m.is_moderator ? '🛡️ ' : ''}{m.username}
              </button>
              {m.pow_wow_guest && (
                <span className="block text-center text-[8px] font-bold text-amber-400">🪶 non-member</span>
              )}

              {/* mod menu */}
              {modMenuId === m.id && (
                <div className="absolute z-40 mt-1 w-44 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                  <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500 border-b border-gray-800">{m.username}</p>
                  <button disabled={busy} onClick={() => ban(m.id, '24h')}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-gray-200 hover:bg-gray-800">Ban 24 hours</button>
                  <button disabled={busy} onClick={() => ban(m.id, '1w')}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-gray-200 hover:bg-gray-800">Ban 1 week</button>
                  <button disabled={busy} onClick={() => ban(m.id, 'perma')}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-red-400 hover:bg-gray-800">Ban permanently</button>
                  {isCreator && !m.pow_wow_guest && (
                    m.is_moderator ? (
                      <button disabled={busy} onClick={() => setMod(m.id, false)}
                        className="w-full text-left px-3 py-2 text-xs font-bold text-gray-200 hover:bg-gray-800 border-t border-gray-800">Remove moderator</button>
                    ) : (
                      <button disabled={busy} onClick={() => setMod(m.id, true)}
                        className="w-full text-left px-3 py-2 text-xs font-bold text-gray-200 hover:bg-gray-800 border-t border-gray-800">🛡️ Make moderator</button>
                    )
                  )}
                  <button onClick={() => setModMenuId(null)}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-800 border-t border-gray-800">Cancel</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
  )

  return (
    <div>
      {strip}

      {/* go-live picker */}
      {goLiveOpen && (
        <div className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4" onClick={() => setGoLiveOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-xs" onClick={e => e.stopPropagation()}>
            <p className="text-white font-black text-sm mb-3">🔴 Go live</p>
            <div className="space-y-2">
              <button onClick={() => goLive('screen')}
                className="w-full py-3 rounded-xl font-bold text-sm text-white bg-gray-800 border border-gray-700 hover:border-gray-500 transition">
                🖥️ Share my screen
              </button>
              <button onClick={() => goLive('camera')}
                className="w-full py-3 rounded-xl font-bold text-sm text-white bg-gray-800 border border-gray-700 hover:border-gray-500 transition">
                📷 Use my camera
              </button>
            </div>
            <button onClick={() => setGoLiveOpen(false)} className="w-full mt-3 py-2 text-xs font-bold text-gray-500 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* THEATRE MODE (Michael): feed fills the top, member strip under it,
          chat below that. ⛶ from here goes true fullscreen. */}
      {theatreId && theatreStream && !fullscreen && (
        <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col">
          <div className="px-4 py-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white">LIVE</span>
              <span className="text-white text-sm font-bold truncate">{theatreMember?.username}</span>
              <button onClick={() => setFullscreen(true)}
                className="ml-auto text-white/80 hover:text-white text-lg leading-none px-1" aria-label="Fullscreen" title="Fullscreen">⛶</button>
              <button onClick={() => setTheatreId(null)}
                className="text-white/80 hover:text-white text-2xl leading-none px-1" aria-label="Close">✕</button>
            </div>
            {/* share sits right under the LIVE badge (Michael) */}
            <button onClick={() => shareLive(theatreMember?.username)}
              className="mt-1 text-[11px] font-bold text-green-400 hover:text-green-300 transition">
              {shared ? '📋 Copied!' : '📤 Share this live'}
            </button>
          </div>
          <div className="bg-black shrink-0" style={{ height: '42vh' }}>
            <video ref={attach(theatreStream)} autoPlay playsInline muted={theatreId === myId}
              className="w-full h-full object-contain" />
          </div>
          <div className="px-4 pt-3 shrink-0">{strip}</div>
          <div className="px-4 pt-2 pb-3 flex-1 flex flex-col min-h-0">
            <CliqueFeed cliqueId={cliqueId} partyColor={partyColor} isCreator={isCreator} readOnly={chatReadOnly} stretch />
          </div>
        </div>
      )}

      {/* FULLSCREEN: the feed edge to edge, chat overlaid along the bottom */}
      {theatreId && theatreStream && fullscreen && (
        <div className="fixed inset-0 z-[100] bg-black">
          <video ref={attach(theatreStream)} autoPlay playsInline muted={theatreId === myId}
            className="absolute inset-0 w-full h-full object-contain" />
          <div className="absolute top-3 left-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white">LIVE</span>
              <span className="text-white text-sm font-bold" style={{ textShadow: '0 1px 4px #000' }}>{theatreMember?.username}</span>
            </div>
            <button onClick={() => shareLive(theatreMember?.username)}
              className="mt-1 text-[11px] font-bold text-green-400 hover:text-green-300 transition" style={{ textShadow: '0 1px 4px #000' }}>
              {shared ? '📋 Copied!' : '📤 Share this live'}
            </button>
          </div>
          <button onClick={() => setFullscreen(false)}
            className="absolute top-3 right-4 text-white/80 hover:text-white text-2xl leading-none" aria-label="Exit fullscreen" title="Exit fullscreen">✕</button>
          <div className="absolute inset-x-0 bottom-0 p-3" style={{ height: '34vh' }}>
            <div className="h-full flex flex-col max-w-2xl mx-auto">
              <CliqueFeed cliqueId={cliqueId} partyColor={partyColor} isCreator={isCreator} readOnly={chatReadOnly} stretch transparent />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
