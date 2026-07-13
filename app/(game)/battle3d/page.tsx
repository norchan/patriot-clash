'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft } from 'lucide-react'
import { MODELS_3D } from '@/config/models3d'

const Battle3D = dynamic(() => import('@/components/Battle3D'), { ssr: false })
const ROSTER = MODELS_3D.filter(m => m.ready !== false)

export default function Battle3DDemo() {
  const router = useRouter()
  const leftAtk = useRef(0)
  const rightAtk = useRef(0)
  const [left, setLeft] = useState('cowboy')
  const [right, setRight] = useState('crazy_liberal')

  const leftM = ROSTER.find(m => m.id === left)!
  const rightM = ROSTER.find(m => m.id === right)!

  return (
    <div className="relative bg-black overflow-hidden" style={{ height: '100dvh' }}>
      {/* key forces a remount when the models change so GLBs reload cleanly */}
      <Battle3D key={`${left}-${right}`}
        leftUrl={leftM.model} rightUrl={rightM.model}
        leftAtk={leftAtk} rightAtk={rightAtk} />

      {/* header */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-4 flex items-center gap-3 z-10">
        <button onClick={() => router.back()} className="text-white/80 hover:text-white"><ArrowLeft size={20} /></button>
        <div>
          <div className="text-white font-black tracking-wide" style={{ textShadow: '0 0 10px #a855f7' }}>3D ROSTER — PREVIEW</div>
          <div className="text-white/50 text-[11px]">Pick fighters · drag to orbit · tap to attack</div>
        </div>
      </div>

      {/* fighter pickers */}
      <div className="absolute top-16 left-0 right-0 px-4 flex gap-2 z-10 max-w-md mx-auto">
        <select value={left} onChange={e => setLeft(e.target.value)}
          className="flex-1 bg-red-950/80 text-white text-sm rounded-lg px-2 py-2 border border-red-700 outline-none">
          {ROSTER.map(m => <option key={m.id} value={m.id}>{m.name} ({m.party === 'republican' ? 'R' : 'D'})</option>)}
        </select>
        <select value={right} onChange={e => setRight(e.target.value)}
          className="flex-1 bg-blue-950/80 text-white text-sm rounded-lg px-2 py-2 border border-blue-700 outline-none">
          {ROSTER.map(m => <option key={m.id} value={m.id}>{m.name} ({m.party === 'republican' ? 'R' : 'D'})</option>)}
        </select>
      </div>

      {/* attack controls */}
      <div className="absolute bottom-8 left-0 right-0 px-6 flex justify-between gap-3 z-10 max-w-md mx-auto">
        <button onClick={() => { leftAtk.current = 0.5 }}
          className="flex-1 py-3.5 rounded-xl font-black text-white active:scale-95 transition truncate"
          style={{ background: 'linear-gradient(180deg,#ef4444,#991b1b)', boxShadow: '0 0 18px rgba(239,68,68,0.5)' }}>
          ⚔️ {leftM.name}
        </button>
        <button onClick={() => { rightAtk.current = 0.5 }}
          className="flex-1 py-3.5 rounded-xl font-black text-white active:scale-95 transition truncate"
          style={{ background: 'linear-gradient(180deg,#3b82f6,#1e3a8a)', boxShadow: '0 0 18px rgba(59,130,246,0.5)' }}>
          ⚔️ {rightM.name}
        </button>
      </div>
    </div>
  )
}
