'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Swords } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { SKIN_TONES, HAIR_COLORS, HAIR_STYLES, RAINBOW, type FighterLook, type HairStyle } from '@/components/BobbleFighter'

const BobbleFighter = dynamic(() => import('@/components/BobbleFighter'), { ssr: false })

const STORAGE_KEY = 'fighter3d_look'

export default function Fighter3DPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const party = (profile?.party as FighterLook['party']) ?? null
  const isDem = party === 'democrat'

  const [look, setLook] = useState<FighterLook>({ party, skin: SKIN_TONES[1], hairStyle: 'short', hairColor: HAIR_COLORS[0] })
  const [attackKey, setAttackKey] = useState(0)
  const [saved, setSaved] = useState(false)

  // load saved look
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) { const s = JSON.parse(raw); setLook(l => ({ ...l, ...s, party })) }
    } catch {}
  }, [party])

  // keep party in sync + drop rainbow if you're not a Democrat
  useEffect(() => {
    setLook(l => ({ ...l, party, hairColor: (l.hairColor === RAINBOW && !isDem) ? HAIR_COLORS[0] : l.hairColor }))
  }, [party, isDem])

  function update(patch: Partial<FighterLook>) {
    setLook(l => { const next = { ...l, ...patch }; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}; return next })
    setSaved(true); setTimeout(() => setSaved(false), 1200)
  }

  const hairOptions = isDem ? [...HAIR_COLORS, RAINBOW] : HAIR_COLORS

  const Label = ({ children }: { children: React.ReactNode }) => (
    <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">{children}</p>
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg">Customize Fighter</h1>
        {saved && <span className="ml-auto text-green-400 text-xs font-bold">Saved ✓</span>}
      </div>

      {/* Live preview */}
      <div className="relative mx-auto" style={{ width: '100%', maxWidth: 440, aspectRatio: '1 / 1',
        background: 'radial-gradient(circle at 50% 40%, rgba(124,58,237,0.18), transparent 70%)' }}>
        <BobbleFighter look={look} attackKey={attackKey} orbit />
        <button onClick={() => setAttackKey(k => k + 1)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg">
          <Swords size={14} /> Test Punch
        </button>
      </div>

      <div className="px-4 space-y-5 mt-3">
        {/* Skin tone */}
        <div>
          <Label>Skin Tone</Label>
          <div className="flex gap-2 flex-wrap">
            {SKIN_TONES.map(c => (
              <button key={c} onClick={() => update({ skin: c })}
                className={`w-10 h-10 rounded-full border-2 transition ${look.skin === c ? 'border-white scale-110' : 'border-gray-700'}`}
                style={{ background: c }} aria-label="skin tone" />
            ))}
          </div>
        </div>

        {/* Hair style */}
        <div>
          <Label>Hair</Label>
          <div className="flex gap-2">
            {HAIR_STYLES.map(s => (
              <button key={s} onClick={() => update({ hairStyle: s })}
                className={`px-4 py-2 rounded-xl text-sm font-bold capitalize transition ${
                  look.hairStyle === s ? 'bg-purple-600 text-white' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}>
                {s === 'none' ? 'No Hair' : s === 'short' ? 'Short' : 'Long'}
              </button>
            ))}
          </div>
        </div>

        {/* Hair color */}
        <div className={look.hairStyle === 'none' ? 'opacity-40 pointer-events-none' : ''}>
          <Label>Hair Color {isDem && <span className="text-purple-400 normal-case">· rainbow unlocked</span>}</Label>
          <div className="flex gap-2 flex-wrap">
            {hairOptions.map(c => (
              <button key={c} onClick={() => update({ hairColor: c })}
                className={`w-10 h-10 rounded-full border-2 transition ${look.hairColor === c ? 'border-white scale-110' : 'border-gray-700'}`}
                style={c === RAINBOW
                  ? { background: 'conic-gradient(#ff2d2d,#ff9e2d,#ffe62d,#37d84a,#2d9bff,#8b5cff,#ff2d2d)' }
                  : { background: c }}
                aria-label="hair color" />
            ))}
          </div>
          {!isDem && <p className="text-gray-600 text-[11px] mt-2">🌈 Rainbow hair is a Democrat-only flex.</p>}
        </div>

        <p className="text-gray-600 text-xs pt-2">
          Your look is saved on this device and will be used for your PvP fighter. Party colors follow your party.
        </p>
      </div>
    </div>
  )
}
