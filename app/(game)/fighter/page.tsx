'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { type FighterPose } from '@/components/FighterRig'
import FighterSprite, { spriteUrl } from '@/components/FighterSprite'
import {
  sanitizeFighter, fighterLevel, fighterStats,
  GENDERS, BODY_TYPES, ARCHETYPES, ARCHETYPE_LABELS, DEFAULT_ARCHETYPE,
  type FighterDesign, type Archetype, type ToneShift,
} from '@/lib/fighter'
import { MOVES, movesForLevel } from '@/lib/pvp'
import { sfx } from '@/lib/juice'

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', trans: 'Trans' }
const BODY_LABELS: Record<string, string> = { skinny: 'Skinny', average: 'Average', athletic: 'Athletic', fat: 'Heavy' }
const TONE_LABELS: { value: ToneShift; label: string }[] = [
  { value: -1, label: 'Lighter' },
  { value: 0, label: 'Natural' },
  { value: 1, label: 'Darker' },
]

// The preview shadowboxes through the real fight moves
const PREVIEW_SEQ: FighterPose[] = ['idle', 'jab', 'idle', 'kick', 'idle', 'jumpkick', 'idle', 'special']
const REACT_POSES: FighterPose[] = ['jab', 'cross', 'kick', 'jumpkick', 'special']

function FighterDesignerContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isWelcome = searchParams.get('welcome') === '1'
  const { profile, loading, refetch } = useProfile()
  const [design, setDesign] = useState<FighterDesign | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [pose, setPose] = useState<FighterPose>('idle')

  useEffect(() => {
    if (!profile || design) return
    setDesign(sanitizeFighter((profile as any).fighter, profile.id))
  }, [profile, design])

  useEffect(() => {
    let i = 0
    const iv = setInterval(() => { i = (i + 1) % PREVIEW_SEQ.length; setPose(PREVIEW_SEQ[i]) }, 800)
    return () => clearInterval(iv)
  }, [])

  function set<K extends keyof FighterDesign>(key: K, value: FighterDesign[K]) {
    setDesign(d => {
      if (!d) return d
      const next = { ...d, [key]: value }
      // Switching gender jumps to that gender's starter character
      if (key === 'gender') next.archetype = DEFAULT_ARCHETYPE[value as FighterDesign['gender']]
      return next
    })
    setPose(REACT_POSES[Math.floor(Math.random() * REACT_POSES.length)])
    sfx.punch(false)
  }

  async function save() {
    if (!design) return
    setSaving(true)
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fighter: design }),
      })
      if (res.ok) {
        setToast('🥊 Fighter saved!')
        await refetch()
        if (isWelcome) {
          setTimeout(() => router.push('/map'), 600)
        }
      } else {
        const d = await res.json()
        setToast(`❌ ${d.error || 'Save failed'}`)
      }
    } catch { setToast('❌ Save failed') }
    setSaving(false)
    setTimeout(() => setToast(''), 3000)
  }

  if (loading || !design || !profile) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>
  }

  const level = fighterLevel(profile.total_battles_won || 0)
  const stats = fighterStats(level)
  const party: 'democrat' | 'republican' = profile.party === 'democrat' ? 'democrat' : 'republican'
  const partyColor = party === 'democrat' ? '#2563eb' : '#dc2626'
  const unlocked = new Set(movesForLevel(level).map(m => m.move))

  const OptionRow = <T extends string>({ label, options, value, labels, onPick }: {
    label: string; options: readonly T[]; value: T; labels?: Record<string, string>; onPick: (v: T) => void
  }) => (
    <div>
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o} onClick={() => onPick(o)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              value === o ? 'text-white' : 'text-gray-400 bg-gray-800 hover:bg-gray-700'
            }`}
            style={value === o ? { background: partyColor } : undefined}>
            {labels?.[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-8">
      <div className="px-4 pt-4 pb-2">
        {!isWelcome && (
          <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white">
            <ArrowLeft size={16} /><span className="text-sm">Back</span>
          </button>
        )}
      </div>

      <div className="px-4">
        <h1 className="text-white font-black text-2xl">
          {isWelcome ? '🥊 Create Your Fighter' : '🥊 My Fighter'}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {isWelcome
            ? 'Welcome to the fight! Pick your fighter — they wear your party colors on the street. Change anytime from your Profile.'
            : 'This is who steps into the street when you battle.'}
        </p>
      </div>

      {/* Preview — shadowboxing on the fight-night street */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden border border-gray-800 relative"
        style={{
          backgroundImage: 'linear-gradient(180deg, rgba(6,5,14,0.45) 0%, transparent 35%, transparent 70%, rgba(6,5,14,0.5) 100%), url(/backgrounds/street_fight.webp)',
          backgroundSize: 'cover', backgroundPosition: 'center 78%',
        }}>
        <div className="flex items-end justify-center pt-6 pb-2" style={{ minHeight: 280 }}>
          <div style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.55))' }}>
            <FighterSprite design={design} party={party} pose={pose} facing="right" height={240} />
          </div>
        </div>
        <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-3 py-1.5">
          <span className="text-white text-xs font-bold">Lv.{level}</span>
          <span className="text-gray-400 text-xs"> · STR {Math.round(stats.strength)} · STA {stats.stamina} · {stats.comboMax}-hit combos</span>
        </div>
      </div>

      <div className="mx-4 mt-4 space-y-4">
        {/* Character select */}
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Fighter</p>
          <div className="grid grid-cols-3 gap-2">
            {ARCHETYPES.map(a => (
              <button key={a} onClick={() => set('archetype', a as Archetype)}
                className="rounded-xl overflow-hidden border-2 transition bg-gray-900 pt-1"
                style={{ borderColor: design.archetype === a ? partyColor : '#1f2937' }}>
                <img
                  src={spriteUrl({ ...design, archetype: a as Archetype }, party, 'idle')}
                  alt={ARCHETYPE_LABELS[a as Archetype]}
                  className="h-24 w-full object-contain"
                  draggable={false}
                />
                <p className={`text-[10px] font-bold py-1 ${design.archetype === a ? 'text-white' : 'text-gray-500'}`}
                  style={design.archetype === a ? { background: partyColor } : undefined}>
                  {ARCHETYPE_LABELS[a as Archetype]}
                </p>
              </button>
            ))}
          </div>
        </div>

        <OptionRow label="Gender" options={GENDERS} value={design.gender} labels={GENDER_LABELS} onPick={v => set('gender', v)} />
        <OptionRow label="Build" options={BODY_TYPES} value={design.body} labels={BODY_LABELS} onPick={v => set('body', v)} />

        {/* Skin tone shift */}
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Skin Tone</p>
          <div className="flex gap-1.5">
            {TONE_LABELS.map(t => (
              <button key={t.value} onClick={() => set('toneShift', t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  design.toneShift === t.value ? 'text-white' : 'text-gray-400 bg-gray-800 hover:bg-gray-700'
                }`}
                style={design.toneShift === t.value ? { background: partyColor } : undefined}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Move ladder */}
        <div>
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">Moves · win fights to level up</p>
          <div className="space-y-1">
            {MOVES.map(m => {
              const has = unlocked.has(m.move)
              return (
                <div key={m.move} className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs ${has ? 'bg-gray-800' : 'bg-gray-900 opacity-60'}`}>
                  <span className={`font-bold ${has ? 'text-white' : 'text-gray-500'}`}>
                    {has ? '✓' : '🔒'} {m.label}
                  </span>
                  <span className="text-gray-500">
                    {has ? `power ${Math.round(m.mult * 100)}%` : `unlocks at Lv.${m.minLevel}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={saving}
            className="flex-1 py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}>
            {saving ? '⏳ Saving...' : isWelcome ? 'Save & Hit the Streets' : 'Save Fighter'}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-50 max-w-md mx-auto">
          <div className="bg-gray-800 text-white px-4 py-3 rounded-xl text-sm text-center shadow-xl border border-gray-700">{toast}</div>
        </div>
      )}
    </div>
  )
}

export default function FighterDesignerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <FighterDesignerContent />
    </Suspense>
  )
}
