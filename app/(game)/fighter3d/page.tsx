'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Swords, Check } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { FIGHTERS } from '@/components/PvpArena3D'

const PvpArena3D = dynamic(() => import('@/components/PvpArena3D'), { ssr: false })
const STORAGE_KEY = 'pvp_fighter'

export default function FighterPickerPage() {
  const router = useRouter()
  const { profile } = useProfile()
  const isDem = profile?.party === 'democrat'
  const partySuffix = isDem ? 'dem' : 'rep' // blue kit for Democrats, red for Republicans
  const roster = FIGHTERS

  const [selected, setSelected] = useState('fighter1')
  const [attackKey, setAttackKey] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s && FIGHTERS.some(f => f.id === s)) setSelected(s) } catch {}
  }, [])

  useEffect(() => { if (!roster.some(f => f.id === selected)) setSelected('fighter1') }, [roster, selected])

  function pick(id: string) {
    setSelected(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
    // persist to profile so opponents render your actual fighter in PvP
    fetch('/api/profile/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pvp_fighter: id }),
    }).catch(() => {})
    setSaved(true); setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-6">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="text-white font-bold text-lg">Choose Your Fighter</h1>
        {saved && <span className="ml-auto text-green-400 text-xs font-bold">Saved ✓</span>}
      </div>

      {/* Live arena preview */}
      <div className="relative mx-auto" style={{ width: '100%', maxWidth: 480, aspectRatio: '1 / 1' }}>
        <PvpArena3D playerPrefix={`${selected}_${partySuffix}`} playerJabRKey={attackKey} solo />
        <button onClick={() => setAttackKey(k => k + 1)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg">
          <Swords size={14} /> Test Punch
        </button>
      </div>

      {/* Roster grid */}
      <div className="px-4 mt-3">
        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
          Fighters <span className={`normal-case ${isDem ? 'text-blue-400' : 'text-red-400'}`}>· {isDem ? '🔵 Democrat blue kit' : '🔴 Republican red kit'}</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {roster.map(f => (
            <button key={f.id} onClick={() => pick(f.id)}
              className={`relative rounded-xl overflow-hidden border-2 transition ${selected === f.id ? 'border-purple-500' : 'border-gray-800'}`}>
              <img src={`/fighters/${f.id}_${partySuffix}.png`} alt={f.label} className="w-full aspect-[3/4] object-cover bg-gray-900" />
              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[11px] font-bold py-1 text-center">{f.label}</div>
              {selected === f.id && (
                <div className="absolute top-1 right-1 bg-purple-600 rounded-full p-0.5"><Check size={12} className="text-white" /></div>
              )}
            </button>
          ))}
        </div>
        <p className="text-gray-600 text-xs mt-3">
          This is your PvP fighter — bobbleheaded and dropped into the street arena when you battle other players.
        </p>
      </div>
    </div>
  )
}
