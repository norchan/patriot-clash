'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { getEnemyById, getRandomEnemy } from '@/config/enemies'
import type { Enemy } from '@/config/enemies'

// Capture rates by tier
const CAPTURE_RATES = { common: 0.75, rare: 0.40, legendary: 0.15 }
const CAPTURE_COSTS = { common: 15, rare: 30, legendary: 75 }

function BattleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profile, refetch } = useProfile()
  const enemyId = searchParams.get('enemy')

  const [enemy, setEnemy] = useState<Enemy | null>(null)
  const [enemyHp, setEnemyHp] = useState(0)
  const [maxHp, setMaxHp] = useState(0)
  const [playerHp, setPlayerHp] = useState(100)
  const [battleLog, setBattleLog] = useState<string[]>([])
  const [phase, setPhase] = useState<'fighting' | 'victory' | 'defeat'>('fighting')
  const [loading, setLoading] = useState(false)
  const [movesUsed, setMovesUsed] = useState<any[]>([])
  const [fpSpent, setFpSpent] = useState(0)
  const [battleId, setBattleId] = useState<string | null>(null)

  // Animation states
  const [enemyAnim, setEnemyAnim] = useState<'idle' | 'hit' | 'attack' | 'dead' | 'charge'>('idle')
  const [shaking, setShaking] = useState(false)
  const [flashColor, setFlashColor] = useState('')
  const [damageNumbers, setDamageNumbers] = useState<{id: number, val: number, isPlayer: boolean}[]>([])
  const [showImpact, setShowImpact] = useState(false)
  const [lowHp, setLowHp] = useState(false)

  // Capture states
  const [canCapture, setCanCapture] = useState(false)
  const [alreadyCaptured, setAlreadyCaptured] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureResult, setCaptureResult] = useState<'success' | 'failed' | null>(null)

  const startTime = useRef(Date.now())
  const logRef = useRef<HTMLDivElement>(null)
  const damageCounter = useRef(0)

  useEffect(() => {
    if (!profile) return
    const e = enemyId ? getEnemyById(enemyId) : getRandomEnemy(profile.party)
    if (e) {
      setEnemy(e)
      setEnemyHp(e.hp)
      setMaxHp(e.hp)
      setBattleLog([`⚔️ A wild ${e.name} appeared!`])
    }
  }, [enemyId, profile])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [battleLog])

  // Check if already captured
  useEffect(() => {
    if (!enemy || !profile) return
    fetch(`/api/collection/check?enemy_id=${enemy.id}`)
      .then(r => r.json())
      .then(data => setAlreadyCaptured(data.captured))
      .catch(() => {})
  }, [enemy, profile])

  // Low HP warning
  useEffect(() => {
    if (enemy && enemyHp / maxHp < 0.25 && enemyHp > 0) {
      setLowHp(true)
    }
  }, [enemyHp, maxHp, enemy])

  function addDamageNumber(val: number, isPlayer: boolean) {
    const id = ++damageCounter.current
    setDamageNumbers(prev => [...prev, { id, val, isPlayer }])
    setTimeout(() => setDamageNumbers(prev => prev.filter(d => d.id !== id)), 800)
  }

  function triggerShake(color: string) {
    setShaking(true)
    setFlashColor(color)
    setTimeout(() => { setShaking(false); setFlashColor('') }, 500)
  }

  async function useMove(moveName: string, moveDamage: number, moveEmoji: string) {
    if (!enemy || !profile || loading || phase !== 'fighting') return
    const fpCost = Math.floor(moveDamage * 0.4)
    if ((profile.fp_balance - fpSpent) < fpCost) {
      setBattleLog(prev => [...prev, `❌ Not enough FP! Need ${fpCost} FP.`])
      return
    }
    setLoading(true)

    // Player attacks — enemy gets hit
    setEnemyAnim('hit')
    setShowImpact(true)
    triggerShake('#ef444433')
    await new Promise(r => setTimeout(r, 100))

    const damage = Math.floor(moveDamage * (0.8 + Math.random() * 0.4))
    const newEnemyHp = Math.max(0, enemyHp - damage)
    setEnemyHp(newEnemyHp)
    setFpSpent(prev => prev + fpCost)
    addDamageNumber(damage, false)

    setTimeout(() => { setEnemyAnim('idle'); setShowImpact(false) }, 500)

    const moveRecord = { name: moveName, power: moveDamage, damage }
    setMovesUsed(prev => [...prev, moveRecord])
    setBattleLog(prev => [...prev, `${moveEmoji} ${moveName} hit for ${damage}! (-${fpCost} FP)`])

    if (newEnemyHp <= 0) {
      setEnemyAnim('dead')
      await new Promise(r => setTimeout(r, 600))
      setBattleLog(prev => [...prev, `🎉 ${enemy.name} was defeated!`])
      const result = await recordBattle('victory', fpCost, [...movesUsed, moveRecord])
      if (result?.battle_id) setBattleId(result.battle_id)
      setCanCapture(!alreadyCaptured)
      setPhase('victory')
      setLoading(false)
      return
    }

    // Enemy charges back
    await new Promise(r => setTimeout(r, 600))
    setEnemyAnim('charge')
    await new Promise(r => setTimeout(r, 300))
    setEnemyAnim('attack')
    triggerShake('#3b82f633')

    const enemyMove = enemy.moves[Math.floor(Math.random() * enemy.moves.length)]
    const enemyDamage = Math.floor(enemyMove.damage * (0.7 + Math.random() * 0.6))
    const newPlayerHp = Math.max(0, playerHp - enemyDamage)
    setPlayerHp(newPlayerHp)
    addDamageNumber(enemyDamage, true)
    setBattleLog(prev => [...prev, `${enemyMove.emoji} ${enemy.name} attacks for ${enemyDamage}!`])

    setTimeout(() => setEnemyAnim('idle'), 500)

    if (newPlayerHp <= 0) {
      await new Promise(r => setTimeout(r, 400))
      setBattleLog(prev => [...prev, `💀 You were defeated...`])
      await recordBattle('defeat', fpCost, [...movesUsed, moveRecord])
      setPhase('defeat')
    }
    setLoading(false)
  }

  async function recordBattle(result: string, fpCost: number, moves: any[]) {
    if (!enemy || !profile) return null
    try {
      const res = await fetch('/api/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enemy_id: enemy.id,
          result,
          fp_spent: fpCost,
          moves_used: moves,
          duration_secs: Math.floor((Date.now() - startTime.current) / 1000),
        }),
      })
      const data = await res.json()
      await refetch()
      return data
    } catch (err) {
      console.error('Failed to record battle:', err)
      return null
    }
  }

  async function attemptCapture() {
    if (!enemy || !profile || capturing) return
    const cost = CAPTURE_COSTS[enemy.tier]
    if ((profile.fp_balance - fpSpent) < cost) {
      setBattleLog(prev => [...prev, `❌ Need ${cost} FP to capture!`])
      return
    }
    setCapturing(true)

    try {
      const res = await fetch('/api/collection/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enemy_id: enemy.id,
          battle_id: battleId,
        }),
      })
      const data = await res.json()
      setCaptureResult(data.captured ? 'success' : 'failed')
      if (data.captured) {
        setBattleLog(prev => [...prev, `🎯 ${enemy.name} was captured!`])
      } else {
        setBattleLog(prev => [...prev, `💨 ${enemy.name} broke free!`])
      }
      await refetch()
    } catch {
      setCaptureResult('failed')
    } finally {
      setCapturing(false)
    }
  }

  async function flee() {
    if (!enemy) return
    await recordBattle('fled', 0, movesUsed)
    router.push('/map')
  }

  if (!enemy || !profile) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading battle...</div>
      </div>
    )
  }

  const hpPercent = (enemyHp / maxHp) * 100
  const partyColor = profile.party === 'democrat' ? '#2563eb' : '#dc2626'
  const enemyPartyColor = profile.party === 'democrat' ? '#dc2626' : '#2563eb'
  const tierColor = enemy.tier === 'legendary' ? '#f59e0b'
    : enemy.tier === 'rare' ? '#8b5cf6' : '#6b7280'
  const captureCost = CAPTURE_COSTS[enemy.tier]
  const captureRate = Math.round(CAPTURE_RATES[enemy.tier] * 100)

  // Enemy transform based on animation state
  const enemyTransform = {
    idle: lowHp ? 'translateY(0px) rotate(-3deg)' : 'translateY(0px)',
    hit: 'translateX(20px) rotate(5deg) scale(0.9)',
    attack: 'translateY(30px) scale(1.15)',
    charge: 'translateY(-10px) scale(1.05)',
    dead: 'translateY(20px) scale(0.5) rotate(15deg)',
  }[enemyAnim]

  const enemyFilter = {
    idle: lowHp ? 'saturate(0.7) brightness(0.9)' : 'none',
    hit: 'brightness(3) saturate(0)',
    attack: 'brightness(1.3)',
    charge: 'brightness(1.2)',
    dead: 'grayscale(1) brightness(0.3)',
  }[enemyAnim]

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden"
      style={{
        background: `linear-gradient(180deg, ${enemyPartyColor}44 0%, #050505 50%)`,
        animation: shaking ? 'shake 0.4s ease-in-out' : 'none',
      }}
    >
      {/* Screen flash */}
      {flashColor && (
        <div
          className="fixed inset-0 z-50 pointer-events-none"
          style={{ background: flashColor, animation: 'flashFade 0.4s ease-out' }}
        />
      )}

      {/* ENEMY ARENA — top 55% */}
      <div className="relative flex flex-col items-center justify-center" style={{ minHeight: '55vh' }}>

        {/* Arena glow background */}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center 60%, ${enemyPartyColor}33 0%, transparent 70%)`,
          }}
        />

        {/* Tier badge */}
        <div className="relative z-10 mb-3 mt-4">
          <span
            className="text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider"
            style={{
              background: `${tierColor}22`,
              color: tierColor,
              border: `1px solid ${tierColor}66`,
            }}
          >
            {enemy.tier === 'legendary' ? '⭐ Legendary' :
             enemy.tier === 'rare' ? '💜 Rare' : '• Common'}
          </span>
        </div>

        {/* Enemy image */}
        <div className="relative z-10 mb-4" style={{ perspective: '500px' }}>
          {/* Impact explosion */}
          {showImpact && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div style={{ animation: 'explode 0.4s ease-out forwards', fontSize: '80px' }}>
                💥
              </div>
            </div>
          )}

          {/* Low HP warning pulse */}
          {lowHp && enemyHp > 0 && (
            <div
              className="absolute inset-0 rounded-2xl z-0"
              style={{
                background: '#ef444422',
                animation: 'pulse 1s infinite',
                borderRadius: '16px',
              }}
            />
          )}

          {/* Damage numbers */}
          {damageNumbers.map(d => (
            <div
              key={d.id}
              className="absolute z-30 font-black pointer-events-none"
              style={{
                top: d.isPlayer ? 'auto' : '-20px',
                bottom: d.isPlayer ? '-20px' : 'auto',
                left: '50%',
                fontSize: d.val > 60 ? '32px' : '24px',
                color: d.isPlayer ? '#ef4444' : '#f59e0b',
                textShadow: `0 0 10px ${d.isPlayer ? '#ef4444' : '#f59e0b'}`,
                animation: 'damageFloat 0.8s ease-out forwards',
              }}
            >
              -{d.val}
            </div>
          ))}

          {enemyAnim === 'attack' && enemy.id === 'oil_baron' ? (
  <video
    src="/animations/oil_baron_attack.mp4"
    autoPlay
    muted
    style={{
      width: '200px',
      height: '200px',
      objectFit: 'cover',
      borderRadius: '20px',
      border: `3px solid ${lowHp && enemyHp > 0 ? '#ef4444' : tierColor}`,
      boxShadow: `0 0 40px ${enemyPartyColor}55`,
    }}
  />
) : (
  <img
    src={enemy.image}
    alt={enemy.name}
    style={{
      width: '200px',
      height: '200px',
      objectFit: 'cover',
      borderRadius: '20px',
      border: `3px solid ${lowHp && enemyHp > 0 ? '#ef4444' : tierColor}`,
      boxShadow: `0 0 40px ${enemyPartyColor}55, 0 8px 32px rgba(0,0,0,0.6)`,
      transform: enemyTransform,
      filter: enemyFilter,
      transition: 'transform 0.2s ease, filter 0.2s ease',
      opacity: enemyAnim === 'dead' ? 0.3 : 1,
    }}
  />
)}
        </div>

        {/* Enemy name + HP */}
        <div className="relative z-10 w-full px-6">
          <div className="flex justify-between items-center mb-1">
            <h2 className="text-white font-black text-lg">{enemy.name}</h2>
            <span className="text-gray-400 text-xs">{enemyHp}/{maxHp} HP</span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
            <div
              className="h-full rounded-full transition-all duration-500 relative overflow-hidden"
              style={{
                width: `${hpPercent}%`,
                background: hpPercent > 50
                  ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                  : hpPercent > 25
                  ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                  : 'linear-gradient(90deg, #b91c1c, #ef4444)',
              }}
            >
              <div className="absolute inset-0 opacity-30"
                style={{ background: 'linear-gradient(90deg, transparent, white, transparent)', animation: 'shimmer 2s infinite' }} />
            </div>
          </div>
          {lowHp && enemyHp > 0 && (
            <p className="text-red-400 text-xs mt-1 font-semibold animate-pulse">
              ⚠️ Weakened — good time to capture!
            </p>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px mx-4 my-1"
        style={{ background: `linear-gradient(90deg, transparent, ${partyColor}, transparent)` }} />

      {/* PLAYER CONTROLS — bottom */}
      <div className="flex-1 bg-gray-950 px-4 pt-3 pb-2">

        {/* Player HP + FP */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400 font-medium">{profile.username}</span>
              <span style={{ color: playerHp > 50 ? '#22c55e' : playerHp > 25 ? '#f59e0b' : '#ef4444' }}>
                {playerHp}/100 HP
              </span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${playerHp}%`,
                  background: playerHp > 50
                    ? `linear-gradient(90deg, ${partyColor}aa, ${partyColor})`
                    : playerHp > 25
                    ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                    : 'linear-gradient(90deg, #b91c1c, #ef4444)',
                }}
              />
            </div>
          </div>
          <div className="bg-gray-900 rounded-lg px-3 py-1.5 border border-gray-800">
            <span className="text-yellow-400 text-xs font-bold">
              ⚡ {(profile.fp_balance - fpSpent).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Battle log */}
        <div ref={logRef}
          className="h-12 overflow-y-auto bg-gray-900 rounded-xl px-3 py-2 mb-3 border border-gray-800">
          {battleLog.map((log, i) => (
            <p key={i} className="text-gray-300 text-xs leading-relaxed">{log}</p>
          ))}
        </div>

        {/* FIGHTING phase */}
        {phase === 'fighting' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {enemy.moves.map(move => {
                const fpCost = Math.floor(move.damage * 0.4)
                const canAfford = (profile.fp_balance - fpSpent) >= fpCost
                return (
                  <button
                    key={move.name}
                    onClick={() => useMove(move.name, move.damage, move.emoji)}
                    disabled={loading || !canAfford}
                    className="p-3 rounded-xl text-left transition-all active:scale-95"
                    style={{
                      background: canAfford ? `${partyColor}22` : '#111827',
                      border: `1px solid ${canAfford ? partyColor + '55' : '#1f2937'}`,
                      opacity: canAfford ? 1 : 0.4,
                    }}
                  >
                    <div className="text-lg mb-0.5">{move.emoji}</div>
                    <div className="text-white text-xs font-semibold truncate">{move.name}</div>
                    <div className="text-gray-400 text-xs">
                      DMG {move.damage} • <span className="text-yellow-500">{fpCost} FP</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <button
              onClick={flee}
              disabled={loading}
              className="w-full py-2 border border-gray-800 rounded-xl text-gray-600 text-xs hover:text-gray-400 transition"
            >
              🏃 Flee
            </button>
          </>
        )}

        {/* VICTORY phase */}
        {phase === 'victory' && (
          <div className="text-center py-2">
            <div className="text-4xl mb-2">🎉</div>
            <h2 className="text-white font-black text-xl mb-1">Victory!</h2>
            <p className="text-green-400 text-sm font-semibold mb-3">
              +{enemy.fpReward} FP earned!
            </p>

            {/* Capture section */}
            {!alreadyCaptured && captureResult === null && (
              <div
                className="rounded-xl p-3 mb-3 border"
                style={{
                  background: `${tierColor}11`,
                  borderColor: `${tierColor}44`,
                }}
              >
                <p className="text-white font-bold text-sm mb-0.5">
                  🎯 Capture {enemy.name}?
                </p>
                <p className="text-gray-400 text-xs mb-2">
                  {captureRate}% success rate • Costs {captureCost} FP
                </p>
                <button
                  onClick={attemptCapture}
                  disabled={capturing || (profile.fp_balance - fpSpent) < captureCost}
                  className="w-full py-2.5 rounded-lg font-bold text-sm transition active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${tierColor}, ${tierColor}bb)`,
                    color: '#000',
                    opacity: (profile.fp_balance - fpSpent) < captureCost ? 0.5 : 1,
                  }}
                >
                  {capturing ? '⏳ Attempting...' : `🎯 Capture! (-${captureCost} FP)`}
                </button>
              </div>
            )}

            {/* Capture result */}
            {captureResult === 'success' && (
              <div className="rounded-xl p-3 mb-3 bg-green-900/40 border border-green-700">
                <p className="text-green-400 font-bold">🎯 Captured {enemy.name}!</p>
                <p className="text-green-600 text-xs">Added to your collection!</p>
              </div>
            )}

            {captureResult === 'failed' && (
              <div className="rounded-xl p-3 mb-3 bg-red-900/40 border border-red-800">
                <p className="text-red-400 font-bold">💨 {enemy.name} broke free!</p>
                <p className="text-red-600 text-xs">Better luck next time!</p>
              </div>
            )}

            {alreadyCaptured && (
              <div className="rounded-xl p-3 mb-3 bg-gray-900 border border-gray-700">
                <p className="text-gray-400 text-sm">✅ Already in your collection!</p>
              </div>
            )}

            <button
              onClick={() => router.push('/map')}
              className="w-full py-3 rounded-xl font-bold text-white transition active:scale-95"
              style={{ background: `linear-gradient(135deg, ${partyColor}, ${partyColor}bb)` }}
            >
              Back to Map
            </button>
          </div>
        )}

        {/* DEFEAT phase */}
        {phase === 'defeat' && (
          <div className="text-center py-2">
            <div className="text-4xl mb-2">💀</div>
            <h2 className="text-white font-black text-xl mb-1">Defeated!</h2>
            <p className="text-gray-400 text-sm mb-4">{enemy.name} was too strong!</p>
            <div className="space-y-2">
              <button
                onClick={() => router.push('/map')}
                className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold transition"
              >
                Back to Map
              </button>
              <button
                onClick={() => router.push('/shop')}
                className="w-full py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)' }}
              >
                ⚡ Buy More FP
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0) translateY(0); }
          20% { transform: translateX(-10px) translateY(-3px) rotate(-1deg); }
          40% { transform: translateX(10px) translateY(3px) rotate(1deg); }
          60% { transform: translateX(-6px) translateY(-2px); }
          80% { transform: translateX(6px) translateY(2px); }
        }
        @keyframes flashFade {
          0% { opacity: 0.7; }
          100% { opacity: 0; }
        }
        @keyframes damageFloat {
          0% { transform: translateX(-50%) translateY(0); opacity: 1; }
          100% { transform: translateX(-50%) translateY(-50px); opacity: 0; }
        }
        @keyframes explode {
          0% { transform: scale(0.3); opacity: 1; }
          60% { transform: scale(1.4); opacity: 0.8; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-200%); }
          100% { transform: translateX(200%); }
        }
        @keyframes pulse {
          0%,100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}

export default function BattlePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <BattleContent />
    </Suspense>
  )
}