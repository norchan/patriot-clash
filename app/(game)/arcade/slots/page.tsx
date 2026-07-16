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
      <div className="pl-4 pr-14 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => router.push('/arcade')} className="text-purple-300 hover:text-white transition">
          <ArrowLeft size={18} />
        </button>
        <span className="text-purple-300 text-xs tracking-widest">ARCADE</span>
        <span className="ml-auto text-yellow-300 text-sm font-black">💰 {profile?.fp_balance?.toLocaleString() ?? 0} FP</span>
      </div>

      <div className="text-center pt-4 pb-6">
        <h1 className="font-black tracking-[0.12em] text-4xl"
          style={{ color: '#facc15', textShadow: '0 0 8px #f59e0b, 0 0 20px #a855f7, 0 3px 0 #7c2d12', animation: 'marqueePulse 2.2s ease-in-out infinite' }}>
          🎰 SLOTS SALUTE
        </h1>
        <p className="mt-2 text-[11px] tracking-widest text-pink-400">★ PICK YOUR MACHINE ★</p>
      </div>

      <div className="flex flex-col items-center gap-4 px-6 pb-28 max-w-sm mx-auto">
        {MACHINES.map(m => (
          <button key={m.id}
            onClick={() => router.push(`/arcade/slots/${m.id}`)}
            className="relative w-full rounded-2xl p-1 text-center transition active:scale-95 overflow-hidden"
            style={{ background: m.frame, boxShadow: `0 0 20px ${m.accent}66` }}>
            <div className="rounded-xl px-5 py-4 overflow-hidden" style={{ background: m.bg }}>
              <div className="flex justify-center gap-1.5 mb-2 text-4xl" style={{ filter: `drop-shadow(0 0 8px ${m.accent})` }}>
                <span>{m.symbols[2].emoji}</span>
                <span className="text-5xl">{m.symbols[0].emoji}</span>
                <span>{m.symbols[3].emoji}</span>
              </div>
              <div className="font-black text-xl tracking-wide" style={{ color: '#fff', textShadow: `0 0 12px ${m.accent}` }}>{m.name}</div>
              <div className="text-white/60 text-xs mt-1 leading-tight">{m.subtitle}</div>
              <div className="flex items-center justify-center gap-2 mt-2 text-[10px] font-bold">
                <span className="px-2 py-0.5 rounded-full" style={{ background: `${m.accent}33`, color: m.accent }}>243 WAYS</span>
                <span className="px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300">FREE SPINS</span>
              </div>
              <div className="mt-3 mx-auto w-fit flex items-center gap-1.5 text-xs font-black px-5 py-2 rounded-full"
                style={{ background: m.accent, color: '#0b0714', boxShadow: `0 0 14px ${m.accent}88` }}>▶ PLAY</div>
            </div>
            {/* sheen sweep */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
              <div className="absolute top-0 bottom-0 w-1/4" style={{
                background: 'linear-gradient(105deg, transparent, rgba(255,255,255,0.14), transparent)',
                animation: 'cardSheen 3.6s ease-in-out infinite',
              }} />
            </div>
          </button>
        ))}
        <p className="text-gray-500 text-[11px] text-center mt-1">Bet 5–100 FP · Match 3 to win big 💥</p>
      </div>

      <style>{`
        @keyframes marqueePulse { 0%,100% { opacity: 1 } 50% { opacity: 0.82 } }
        @keyframes cardSheen { 0% { left: -30% } 55%, 100% { left: 110% } }
      `}</style>
    </div>
  )
}
