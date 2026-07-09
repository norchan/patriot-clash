'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import FighterRig, { type FighterPose } from '@/components/FighterRig'
import {
  defaultFighter, sanitizeFighter, fighterLevel, fighterStats,
  GENDERS, BODY_TYPES, HAIR_STYLES, TOP_STYLES,
  FACIAL_HAIRS, EYEWEARS, HATS,
  SKIN_TONES, HAIR_COLORS, TOP_COLORS, PANT_COLORS,
  type FighterDesign,
} from '@/lib/fighter'
import { sfx } from '@/lib/juice'

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', trans: 'Trans' }
const BODY_LABELS: Record<string, string> = { skinny: 'Skinny', average: 'Average', athletic: 'Athletic', fat: 'Heavy' }
const HAIR_LABELS: Record<string, string> = { short: 'Short', long: 'Long', bun: 'Bun', afro: 'Afro', ponytail: 'Ponytail', bald: 'Bald' }
const TOP_LABELS: Record<string, string> = { tee: 'T-Shirt', tank: 'Tank Top', hoodie: 'Hoodie' }
const FUZZ_LABELS: Record<string, string> = { none: 'Clean', mustache: 'Mustache', beard: 'Beard', goatee: 'Goatee' }
const EYEWEAR_LABELS: Record<string, string> = { none: 'None', glasses: 'Glasses', shades: 'Shades' }
const HAT_LABELS: Record<string, string> = { none: 'None', cap: 'Cap', beanie: 'Beanie', cowboy: 'Cowboy Hat' }

const REACT_POSES: FighterPose[] = ['jab', 'cross', 'hook', 'uppercut', 'kick']

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

  // Preview loop: shadowbox through a few moves
  useEffect(() => {
    const seq: FighterPose[] = ['idle', 'jab', 'idle', 'cross', 'idle', 'kick', 'idle', 'hook']
    let i = 0
    const iv = setInterval(() => { i = (i + 1) % seq.length; setPose(seq[i]) }, 700)
    return () => clearInterval(iv)
  }, [])

  function set<K extends keyof FighterDesign>(key: K, value: FighterDesign[K]) {
    setDesign(d => d ? { ...d, [key]: value } : d)
    // Every tweak makes the fighter throw a punch — instant feedback that
    // the change landed (the shadowbox loop takes back over on its next tick)
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
  const partyColor = profile.party === 'democrat' ? '#2563eb' : '#dc2626'

  const OptionRow = <T extends string>({ label, options, value, labels, onPick }: {
    label: string; options: T[]; value: T; labels?: Record<string, string>; onPick: (v: T) => void
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

  const SwatchRow = ({ label, options, value, onPick }: {
    label: string; options: string[]; value: string; onPick: (v: string) => void
  }) => (
    <div>
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(c => (
          <button key={c} onClick={() => onPick(c)}
            className="w-8 h-8 rounded-full border-2 transition"
            style={{ background: c, borderColor: value === c ? 'white' : 'transparent' }} />
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
            ? 'Welcome to the fight! This is who represents you on the street. You can change it anytime from your Profile.'
            : 'This is who steps into the street when you battle.'}
        </p>
      </div>

      {/* Preview — the fighter shadowboxes on the real fight-night street */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden border border-gray-800 relative"
        style={{
          backgroundImage: 'linear-gradient(180deg, rgba(6,5,14,0.45) 0%, transparent 35%, transparent 70%, rgba(6,5,14,0.5) 100%), url(/backgrounds/street_fight.webp)',
          backgroundSize: 'cover', backgroundPosition: 'center 78%',
        }}>
        <div className="flex items-end justify-center pt-6" style={{ minHeight: 260 }}>
          <div style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.55))' }}>
            <FighterRig design={design} pose={pose} facing="right" height={220} />
          </div>
        </div>
        <div className="h-2" />
        <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-3 py-1.5">
          <span className="text-white text-xs font-bold">Lv.{level}</span>
          <span className="text-gray-400 text-xs"> · STR {Math.round(stats.strength)} · STA {stats.stamina} · {stats.comboMax}-hit combos</span>
        </div>
      </div>

      {/* Options */}
      <div className="mx-4 mt-4 space-y-4">
        <OptionRow label="Gender" options={GENDERS} value={design.gender} labels={GENDER_LABELS} onPick={v => set('gender', v)} />
        <OptionRow label="Build" options={BODY_TYPES} value={design.body} labels={BODY_LABELS} onPick={v => set('body', v)} />
        <SwatchRow label="Skin Tone" options={SKIN_TONES} value={design.skin} onPick={v => set('skin', v)} />
        <OptionRow label="Hair" options={HAIR_STYLES} value={design.hairStyle} labels={HAIR_LABELS} onPick={v => set('hairStyle', v)} />
        {design.hairStyle !== 'bald' && (
          <SwatchRow label="Hair Color" options={HAIR_COLORS} value={design.hairColor} onPick={v => set('hairColor', v)} />
        )}
        <OptionRow label="Facial Hair" options={FACIAL_HAIRS} value={design.facialHair} labels={FUZZ_LABELS} onPick={v => set('facialHair', v)} />
        <OptionRow label="Eyewear" options={EYEWEARS} value={design.eyewear} labels={EYEWEAR_LABELS} onPick={v => set('eyewear', v)} />
        <OptionRow label="Hat" options={HATS} value={design.hat} labels={HAT_LABELS} onPick={v => set('hat', v)} />
        <OptionRow label="Top" options={TOP_STYLES} value={design.topStyle} labels={TOP_LABELS} onPick={v => set('topStyle', v)} />
        <SwatchRow label="Top Color" options={TOP_COLORS} value={design.topColor} onPick={v => set('topColor', v)} />
        <SwatchRow label="Pants" options={PANT_COLORS} value={design.pantColor} onPick={v => set('pantColor', v)} />

        <div className="flex gap-2 pt-2">
          <button onClick={() => setDesign(defaultFighter(`${profile.id}${Date.now()}`))}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold text-sm transition">
            🎲 Randomize
          </button>
          <button onClick={save} disabled={saving}
            className="flex-[2] py-3 rounded-xl font-bold text-white transition active:scale-95 disabled:opacity-50"
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
