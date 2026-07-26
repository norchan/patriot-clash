'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { ArrowLeft, Settings, Share2 } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { BANNERS } from '@/config/banners'
import CliqueFeed from '@/components/CliqueFeed'
import CliqueLiveRow from '@/components/CliqueLiveRow'

interface Member { id: string; username: string; avatar_url: string | null; total_battles_won: number; pow_wow_guest?: boolean; is_moderator?: boolean }
interface Pending { id: string; username: string; avatar_url: string | null }
interface Clique {
  id: string; name: string; party: 'democrat' | 'republican'; gym_id: string | null
  creator_id: string; join_policy: 'open' | 'request'; banner_url: string | null
}

export default function CliquePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { isSignedIn, isLoaded } = useUser()
  const { profile } = useProfile()

  const [clique, setClique] = useState<Clique | null>(null)
  const [gym, setGym] = useState<{ city_name: string; state: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [isMember, setIsMember] = useState(false)
  const [isCreator, setIsCreator] = useState(false)
  const [memberCount, setMemberCount] = useState(0)
  const [powWow, setPowWow] = useState(false)
  const [isPowWowGuest, setIsPowWowGuest] = useState(false)
  const [amModerator, setAmModerator] = useState(false)
  const [bannedMe, setBannedMe] = useState(false)
  const [guestLiveAllowed, setGuestLiveAllowed] = useState(false)
  const [guestChatAllowed, setGuestChatAllowed] = useState(true)
  const [loading, setLoading] = useState(true)

  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  // Share the clique — the message calls out a live pow-wow (Michael)
  async function shareClique() {
    if (!clique) return
    const url = `${window.location.origin}/cliques/${params.id}`
    const town = gym ? ` out of ${gym.city_name}, ${gym.state}` : ''
    const msg = powWow
      ? `🪶 POW-WOW LIVE right now at ${clique.name} on PoliticsGo — the doors are open, come hang out, watch the live feeds, and chat!`
      : `✊ Come join my clique ${clique.name} on PoliticsGo${town} — we need you in the fight!`
    try {
      if (navigator.share) await navigator.share({ title: 'PoliticsGo', text: msg, url })
      else { await navigator.clipboard.writeText(`${msg} ${url}`); showToast('📋 Invite copied — paste it anywhere!') }
    } catch { /* share sheet closed */ }
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/cliques/${params.id}`)
    const d = await res.json()
    if (!res.ok) { showToast(`❌ ${d.error || 'Not found'}`); setLoading(false); return }
    setClique(d.clique); setGym(d.gym); setMembers(d.members ?? []); setPending(d.pending ?? [])
    setIsMember(d.is_member); setIsCreator(d.is_creator); setMemberCount(d.member_count ?? 0)
    setPowWow(!!d.pow_wow); setIsPowWowGuest(!!d.is_pow_wow_guest)
    setAmModerator(!!d.am_moderator); setBannedMe(!!d.banned)
    setGuestLiveAllowed(!!d.pow_wow_guest_live); setGuestChatAllowed(d.pow_wow_guest_chat !== false)
    setLoading(false)
  }, [params.id])

  // Pow-Wow controls: creator starts/ends; anyone joins while it's live
  async function powWowAction(action: 'start' | 'end' | 'join') {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/powwow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Failed'}`); return }
      if (action === 'start') showToast('🪶 Pow-Wow started — the clique is open to everyone!')
      else if (action === 'end') showToast('🪶 Pow-Wow ended')
      else showToast('🪶 You joined the Pow-Wow — say hi in the chat!')
      await load()
    } catch { showToast('❌ Failed') }
    finally { setBusy(false) }
  }

  useEffect(() => { load() }, [load])

  async function saveSettings(updates: { join_policy?: string; banner_url?: string | null; pow_wow_guest_live?: boolean; pow_wow_guest_chat?: boolean }) {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Save failed'}`); return }
      setClique(c => c ? { ...c, ...d.clique } : c)
      if (d.clique?.pow_wow_guest_live !== undefined) setGuestLiveAllowed(!!d.clique.pow_wow_guest_live)
      if (d.clique?.pow_wow_guest_chat !== undefined) setGuestChatAllowed(d.clique.pow_wow_guest_chat !== false)
      if (updates.join_policy === 'open') { showToast('🚪 Clique is now open — pending requests admitted'); load() }
      else if (updates.join_policy) showToast('🔒 Now request-only')
      else if ((updates as any).pow_wow_guest_live !== undefined || (updates as any).pow_wow_guest_chat !== undefined) showToast('🪶 Pow-Wow rules updated')
      else showToast('🖼️ Banner updated')
    } catch { showToast('❌ Save failed') }
    finally { setBusy(false) }
  }

  // Same-party visitors can join (or request) right from this page
  async function joinClique() {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/join`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { showToast(`❌ ${d.error || 'Could not join'}`); return }
      if (d.status === 'member') { showToast('🎉 Welcome to the clique!'); load() }
      else { setRequested(true); showToast('📨 Request sent — waiting for approval') }
    } catch { showToast('❌ Could not join') }
    finally { setBusy(false) }
  }

  async function manageMember(profileId: string, action: 'approve' | 'deny' | 'remove') {
    setBusy(true)
    try {
      const res = await fetch(`/api/cliques/${params.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, action }),
      })
      if (!res.ok) { const d = await res.json(); showToast(`❌ ${d.error || 'Failed'}`); return }
      load()
    } catch { showToast('❌ Failed') }
    finally { setBusy(false) }
  }

  // Signed-out visitor from a shared invite link: the OG preview did its job,
  // now pitch the signup (the API is members-gated so there's nothing to show)
  if (isLoaded && !isSignedIn) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-6xl">✊</div>
      <h1 className="text-white font-black text-2xl">You&apos;ve been invited to a clique!</h1>
      <p className="text-gray-400 text-sm max-w-sm">
        Cliques are PoliticsGo crews that band together around a town hall — chat, go live, and fight for the map. Sign up free to join them.
      </p>
      <button onClick={() => router.push('/sign-up')}
        className="mt-3 px-8 py-3 rounded-xl font-black text-white"
        style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
        Join PoliticsGo →
      </button>
    </div>
  )

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading clique...</p></div>
  if (!clique) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <p className="text-gray-400">Clique not found.</p>
      <button onClick={() => router.push('/cliques')} className="text-blue-400 text-sm">← Back to Cliques</button>
    </div>
  )

  // banned players get the door, pow-wow or not
  if (bannedMe) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="text-5xl">🚫</div>
      <p className="text-gray-300 font-bold">You&apos;re banned from this clique.</p>
      <button onClick={() => router.push('/cliques')} className="text-blue-400 text-sm">← Back to Cliques</button>
    </div>
  )

  const partyColor = clique.party === 'democrat' ? '#2563eb' : '#dc2626'
  const sameParty = profile?.party === clique.party

  return (
    <div className="min-h-screen bg-gray-950 pb-8">
      {/* Banner */}
      <div className="relative h-40" style={{
        background: clique.banner_url
          ? `linear-gradient(180deg, rgba(3,7,18,0.15), rgba(3,7,18,0.92)), url(${clique.banner_url}) center/cover`
          : `linear-gradient(135deg, ${partyColor}, ${partyColor}44)`,
      }}>
        <button onClick={() => router.push('/cliques')}
          className="absolute top-4 left-4 bg-black/50 rounded-full p-2 text-white">
          <ArrowLeft size={16} />
        </button>
        {isCreator && (
          <button onClick={() => setShowSettings(s => !s)}
            className="absolute top-4 right-4 bg-black/50 rounded-full p-2 text-white">
            <Settings size={16} />
          </button>
        )}
        {/* share the clique — invite message flags a live pow-wow */}
        <button onClick={shareClique}
          className={`absolute top-4 ${isCreator ? 'right-14' : 'right-4'} bg-black/50 rounded-full p-2 text-white hover:text-green-300 transition`}
          aria-label="Share this clique" title="Share this clique">
          <Share2 size={16} />
        </button>
        <div className="absolute bottom-3 left-4 right-4">
          <h1 className="text-white font-black text-xl drop-shadow">{clique.name}</h1>
          <p className="text-gray-300 text-xs">
            {sameParty
              ? <>
                  {memberCount} member{memberCount !== 1 ? 's' : ''}
                  {gym ? <> · <span role="link" onClick={() => clique.gym_id && router.push(`/townhall/${clique.gym_id}`)}
                    className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-white">{gym.city_name}, {gym.state}</span></> : null}
                  {' · '}{clique.join_policy === 'open' ? '🚪 Open to all' : '🔒 Request to join'}
                </>
              : gym
                ? <span role="link" onClick={() => clique.gym_id && router.push(`/townhall/${clique.gym_id}`)}
                    className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-white">{gym.city_name}, {gym.state}</span>
                : `${clique.party === 'democrat' ? 'Democrat' : 'Republican'} clique`}
          </p>
        </div>
      </div>

      {/* Creator settings */}
      {isCreator && showSettings && (
        <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4 space-y-4">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Who can join?</p>
            <div className="flex gap-2">
              {(['open', 'request'] as const).map(p => (
                <button key={p} onClick={() => saveSettings({ join_policy: p })} disabled={busy}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${clique.join_policy === p ? 'text-white' : 'text-gray-400 bg-gray-800'}`}
                  style={clique.join_policy === p ? { background: partyColor } : undefined}>
                  {p === 'open' ? '🚪 Anyone can join' : '🔒 Approve requests'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Pow-Wow rules — non-member guests</p>
            <div className="flex gap-2">
              <button onClick={() => saveSettings({ pow_wow_guest_live: !guestLiveAllowed } as any)} disabled={busy}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${guestLiveAllowed ? 'text-white bg-amber-700' : 'text-gray-400 bg-gray-800'}`}>
                {guestLiveAllowed ? '🔴 Guests can go live' : '🚫 Guests can\'t go live'}
              </button>
              <button onClick={() => saveSettings({ pow_wow_guest_chat: !guestChatAllowed } as any)} disabled={busy}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${guestChatAllowed ? 'text-white bg-amber-700' : 'text-gray-400 bg-gray-800'}`}>
                {guestChatAllowed ? '💬 Guests can chat' : '👀 Guests read-only'}
              </button>
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Banner</p>
            <div className="grid grid-cols-2 gap-2">
              {BANNERS.map(b => (
                <button key={b.id} onClick={() => saveSettings({ banner_url: b.url })} disabled={busy}
                  className="rounded-lg overflow-hidden border-2 transition"
                  style={{ borderColor: clique.banner_url === b.url ? partyColor : '#1f2937' }}>
                  <img src={b.url} alt={b.name} className="h-14 w-full object-cover" />
                  <p className="text-[10px] text-gray-400 py-1">{b.name}</p>
                </button>
              ))}
            </div>
            <button onClick={() => saveSettings({ banner_url: null })} disabled={busy}
              className="w-full mt-2 py-2 bg-gray-800 text-gray-400 rounded-lg text-xs font-bold">
              Use party color
            </button>
          </div>
        </div>
      )}

      {/* Join requests (creator, request-only) */}
      {isCreator && pending.length > 0 && (
        <div className="mx-4 mt-3 bg-gray-900 rounded-2xl p-4">
          <p className="text-gray-400 text-xs font-bold mb-2">📨 Join Requests ({pending.length})</p>
          {pending.map(p => (
            <div key={p.id} className="flex items-center gap-2 py-1.5">
              <span className="text-white text-sm flex-1 truncate">{p.username}</span>
              <button onClick={() => manageMember(p.id, 'approve')} disabled={busy}
                className="text-xs font-bold px-2 py-1 rounded bg-green-600 text-white">✓</button>
              <button onClick={() => manageMember(p.id, 'deny')} disabled={busy}
                className="text-xs font-bold px-2 py-1 rounded bg-gray-700 text-gray-300">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Pow-Wow strip — live banner for everyone; start/end for the creator */}
      {powWow && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-600/60 bg-amber-900/20 px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">🪶</span>
          <div className="flex-1 min-w-0">
            <p className="text-amber-300 text-sm font-bold">Pow-Wow LIVE</p>
            <p className="text-amber-200/70 text-xs">The clique is open — anyone can hang out and chat.</p>
          </div>
          {isCreator ? (
            <button onClick={() => powWowAction('end')} disabled={busy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-700 text-white hover:bg-amber-600 transition disabled:opacity-50">
              End it
            </button>
          ) : (!isMember && !isPowWowGuest) ? (
            <button onClick={() => powWowAction('join')} disabled={busy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition disabled:opacity-50">
              Join the Pow-Wow
            </button>
          ) : null}
        </div>
      )}
      {isCreator && !powWow && (
        <div className="mx-4 mt-3">
          <button onClick={() => powWowAction('start')} disabled={busy}
            className="w-full py-2.5 rounded-xl text-sm font-bold border border-amber-700/60 bg-amber-900/15 text-amber-300 hover:bg-amber-900/30 transition disabled:opacity-50">
            🪶 Start a Pow-Wow — open the clique to everyone
          </button>
        </div>
      )}

      {(!isMember && !powWow) ? (
        sameParty ? (
          // Same party: they can join (or request) right here
          <div className="mx-4 mt-6 text-center">
            <div className="text-5xl mb-3">🔒</div>
            <p className="text-gray-400 text-sm">This clique&apos;s feed is members-only.</p>
            {profile?.clique_id ? (
              <p className="text-gray-600 text-xs mt-1">Leave your current clique first to join this one.</p>
            ) : requested ? (
              <p className="text-yellow-400 text-sm font-bold mt-3">📨 Request sent — waiting for approval</p>
            ) : (
              <button onClick={joinClique} disabled={busy}
                className="mt-4 px-8 py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
                style={{ background: partyColor }}>
                {clique.join_policy === 'open' ? '✊ Join Clique' : '📨 Request to Join'}
              </button>
            )}
          </div>
        ) : (
          // Rival party: name + town only (more visible to rivals later)
          <div className="mx-4 mt-6 text-center">
            <div className="text-5xl mb-3">✊</div>
            <p className="text-gray-400 text-sm">
              A {clique.party === 'democrat' ? 'Democrat' : 'Republican'} clique{gym ? ` out of ${gym.city_name}, ${gym.state}` : ''}.
            </p>
            <p className="text-gray-600 text-xs mt-1">Rival cliques keep their business to themselves.</p>
          </div>
        )
      ) : (
        <>
          {/* Members strip — always visible squares; live feeds swap in.
              Pow-wow guests ride along tagged as non-members. */}
          <div className="mx-4 mt-4 bg-gray-900 rounded-2xl p-4">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">{memberCount} member{memberCount !== 1 ? 's' : ''}</p>
            <CliqueLiveRow
              cliqueId={String(params.id)}
              members={members}
              myId={profile?.id ?? null}
              creatorId={clique.creator_id}
              isCreator={isCreator}
              amModerator={amModerator}
              canGoLive={isMember || (powWow && isPowWowGuest && guestLiveAllowed)}
              partyColor={partyColor}
              chatReadOnly={!isMember && (!isPowWowGuest || !guestChatAllowed)}
              onChanged={load}
            />
          </div>

          {/* Live chat — during a Pow-Wow everyone can read; guests post
              only if they joined AND the owner allows guest chat */}
          <div className="mx-4 mt-3">
            <CliqueFeed cliqueId={String(params.id)} partyColor={partyColor} isCreator={isCreator}
              readOnly={!isMember && (!isPowWowGuest || !guestChatAllowed)} />
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}
