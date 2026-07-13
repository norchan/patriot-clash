'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft } from 'lucide-react'

// r3f/three must be client-only (no SSR)
const Battle3D = dynamic(() => import('@/components/Battle3D'), { ssr: false })

export default function Battle3DDemo() {
  const router = useRouter()
  const leftAtk = useRef(0)
  const rightAtk = useRef(0)

  return (
    <div className="relative bg-black overflow-hidden" style={{ height: '100dvh' }}>
      <Battle3D
        leftUrl="/models/cowboy.glb"
        rightUrl="/models/crazy_liberal.glb"
        leftAtk={leftAtk}
        rightAtk={rightAtk}
      />

      {/* header */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-4 flex items-center gap-3 z-10 pointer-events-none">
        <button onClick={() => router.back()} className="text-white/80 hover:text-white pointer-events-auto"><ArrowLeft size={20} /></button>
        <div className="pointer-events-none">
          <div className="text-white font-black tracking-wide" style={{ textShadow: '0 0 10px #a855f7' }}>3D BATTLE — PREVIEW</div>
          <div className="text-white/50 text-[11px]">Drag to orbit · pinch to zoom · tap the buttons to attack</div>
        </div>
      </div>

      {/* attack controls */}
      <div className="absolute bottom-8 left-0 right-0 px-6 flex justify-between gap-3 z-10 max-w-md mx-auto">
        <button onClick={() => { leftAtk.current = 0.5 }}
          className="flex-1 py-3.5 rounded-xl font-black text-white active:scale-95 transition"
          style={{ background: 'linear-gradient(180deg,#ef4444,#991b1b)', boxShadow: '0 0 18px rgba(239,68,68,0.5)' }}>
          🤠 COWBOY ATTACK
        </button>
        <button onClick={() => { rightAtk.current = 0.5 }}
          className="flex-1 py-3.5 rounded-xl font-black text-white active:scale-95 transition"
          style={{ background: 'linear-gradient(180deg,#3b82f6,#1e3a8a)', boxShadow: '0 0 18px rgba(59,130,246,0.5)' }}>
          🧢 LIBERAL ATTACK
        </button>
      </div>
    </div>
  )
}
