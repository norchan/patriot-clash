'use client'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { MACHINES } from '@/config/slots'
import { useProfile } from '@/hooks/useProfile'

// Slots Salute — pick your machine.
export default function SlotsChooser() {
  const router = useRouter()
  const { profile } = useProfile()

  return (
    <div className="min-h-screen text-white relative"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #2a0a4a 0%, #0a0616 60%, #050208 100%)', fontFamily: 'ui-monospace, monospace' }}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade')} className="text-purple-300 hover:text-white transition">
          <ArrowLeft size={18} />
        </button>
        <span className="text-purple-300 text-xs tracking-widest">ARCADE</span>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {profile?.fp_balance?.toLocaleString() ?? 0} FP</span>
      </div>

      <div className="text-center pt-4 pb-6">
        <h1 className="font-black tracking-[0.12em] text-4xl"
          style={{ color: '#facc15', textShadow: '0 0 8px #f59e0b, 0 0 20px #a855f7, 0 3px 0 #7c2d12' }}>
          🎰 SLOTS SALUTE
        </h1>
        <p className="mt-2 text-[11px] tracking-widest text-pink-400">★ PICK YOUR MACHINE ★</p>
      </div>

      <div className="flex flex-col items-center gap-4 px-6 pb-28 max-w-sm mx-auto">
        {MACHINES.map(m => (
          <button key={m.id}
            onClick={() => router.push(`/arcade/slots/${m.id}`)}
            className="relative w-full rounded-2xl p-5 text-center transition active:scale-95 overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, rgba(20,12,36,0.92), rgba(8,4,16,0.96))',
              border: `2px solid ${m.accent}`,
              boxShadow: `0 0 16px ${m.accent}55, inset 0 0 24px ${m.accent}18`,
            }}>
            <div className="flex justify-center gap-1 mb-2 text-4xl" style={{ filter: `drop-shadow(0 0 8px ${m.accent})` }}>
              <span>{m.symbols[0].emoji}</span>
              <span>{m.symbols[2].emoji}</span>
              <span>{m.symbols[1].emoji}</span>
            </div>
            <div className="font-black text-lg tracking-wide" style={{ color: m.accent }}>{m.name}</div>
            <div className="text-gray-400 text-xs mt-1 leading-tight">{m.subtitle}</div>
            <div className="mt-2.5 text-xs font-black tracking-[0.2em] text-green-400">▶ PLAY</div>
          </button>
        ))}
        <p className="text-gray-500 text-[11px] text-center mt-1">Bet 5–100 FP · Match 3 to win big 💥</p>
      </div>
    </div>
  )
}
