'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Bell, BellOff } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

// Notification control center — reachable from Settings. Two layers:
//  1. per-type switches (mute a category everywhere, in-app AND push)
//  2. push on/off for THIS device (browser permission + subscription)

const TYPES: { key: 'dm' | 'pvp' | 'social' | 'system'; label: string; desc: string; emoji: string }[] = [
  { key: 'dm', label: 'Messages', desc: 'Direct messages and chat requests', emoji: '💬' },
  { key: 'pvp', label: 'PvP Fights', desc: 'Challenges, fight results', emoji: '🥊' },
  { key: 'social', label: 'Social', desc: 'Friends, cliques, town hall activity', emoji: '👥' },
  { key: 'system', label: 'Game News', desc: 'Rewards, events, updates', emoji: '📣' },
]

function urlB64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export default function NotificationSettingsPage() {
  const router = useRouter()
  const { profile, refetch } = useProfile()
  const [toggling, setToggling] = useState<string | null>(null)
  const [pushState, setPushState] = useState<'unsupported' | 'off' | 'on' | 'denied' | 'busy'>('busy')
  const [msg, setMsg] = useState('')

  const prefs = (profile as any)?.notification_prefs ?? {}

  // discover this device's push status
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
      if (Notification.permission === 'denied') { setPushState('denied'); return }
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg && await reg.pushManager.getSubscription()
        setPushState(sub ? 'on' : 'off')
      } catch { setPushState('off') }
    })()
  }, [])

  async function enablePush() {
    setPushState('busy'); setMsg('')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'off'); return }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('save failed')
      setPushState('on')
      setMsg('✅ Push is ON for this device')
    } catch (e) {
      console.error(e)
      setPushState('off')
      setMsg('❌ Could not enable push — try again')
    }
  }

  async function disablePush() {
    setPushState('busy'); setMsg('')
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg && await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setPushState('off')
      setMsg('Push is off for this device')
    } catch { setPushState('on'); setMsg('❌ Could not disable — try again') }
  }

  async function toggleType(key: string, muted: boolean) {
    setToggling(key)
    try {
      await fetch('/api/profile/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_prefs: { [key]: muted } }), // muted=false → turning ON
      })
      await refetch()
    } catch {}
    setToggling(null)
  }

  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone)

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-28">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button onClick={() => router.push('/settings')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-bold text-lg">🔔 Notifications</h1>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {/* push on this device */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center gap-3">
            {pushState === 'on' ? <Bell size={20} className="text-green-400" /> : <BellOff size={20} className="text-gray-500" />}
            <div className="flex-1">
              <div className="font-bold text-sm">Push on this device</div>
              <div className="text-gray-500 text-xs mt-0.5">
                {pushState === 'unsupported' && 'This browser doesn’t support push.'}
                {pushState === 'denied' && 'Blocked in your browser settings — allow notifications for politicsgo.app to use push.'}
                {pushState === 'on' && 'You’ll get notifications even when the app is closed.'}
                {pushState === 'off' && 'Get pinged for messages, fights and friends — even with the app closed.'}
                {pushState === 'busy' && 'Working…'}
              </div>
            </div>
            {pushState === 'on' && (
              <button onClick={disablePush} className="px-3 py-2 rounded-full text-xs font-black bg-white/10">TURN OFF</button>
            )}
            {pushState === 'off' && (
              <button onClick={enablePush} className="px-3 py-2 rounded-full text-xs font-black"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>TURN ON</button>
            )}
          </div>
          {msg && <p className="text-xs mt-2 text-gray-300">{msg}</p>}
          {!isStandalone && pushState !== 'unsupported' && (
            <p className="text-[11px] text-gray-600 mt-2">
              📱 iPhone: install the app first (Share → Add to Home Screen), then enable push from inside the installed app.
            </p>
          )}
        </div>

        {/* per-category switches */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 divide-y divide-gray-800">
          {TYPES.map(t => {
            const on = prefs[t.key] !== false
            return (
              <button key={t.key} onClick={() => toggleType(t.key, on)} disabled={toggling === t.key}
                className="w-full flex items-center gap-3 p-4 text-left disabled:opacity-50">
                <span className="text-xl">{t.emoji}</span>
                <div className="flex-1">
                  <div className="font-bold text-sm">{t.label}</div>
                  <div className="text-gray-500 text-xs">{t.desc}</div>
                </div>
                <span className={`w-11 h-6 rounded-full relative transition ${on ? 'bg-green-500' : 'bg-gray-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-gray-600 text-[11px] text-center">
          Category switches mute a type everywhere (in-app and push). The device switch only affects this phone/browser.
        </p>
      </div>
    </div>
  )
}
