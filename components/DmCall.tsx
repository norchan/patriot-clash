'use client'
import { useState, useEffect, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

// DM VIDEO CALL (Michael): facetime inside messages. 1:1 WebRTC — camera +
// mic, signaled over a Supabase channel per conversation. The page shows the
// 📹 button (caller) and the incoming banner (callee); this component runs
// the actual call once a side commits.
//
// Events on dm-call:{convId} — ring (page-level), accept, offer, answer,
// ice, decline, hangup.

const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

export default function DmCall({ convId, myId, otherName, role, onClose }: {
  convId: string
  myId: string
  otherName: string
  role: 'caller' | 'callee'
  onClose: () => void
}) {
  const [status, setStatus] = useState(role === 'caller' ? 'Calling…' : 'Connecting…')
  const [connected, setConnected] = useState(false)
  const [micOn, setMicOn] = useState(true)

  const chRef = useRef<any>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const ringTimerRef = useRef<any>(null)
  const timeoutRef = useRef<any>(null)
  const closedRef = useRef(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const ch = supabase.channel(`dm-call:${convId}`, { config: { broadcast: { self: false } } })
    chRef.current = ch
    const send = (event: string, payload: any = {}) =>
      ch.send({ type: 'broadcast', event, payload: { ...payload, from: myId } })

    const cleanup = () => {
      if (closedRef.current) return
      closedRef.current = true
      clearInterval(ringTimerRef.current)
      clearTimeout(timeoutRef.current)
      try { pcRef.current?.close() } catch {}
      localRef.current?.getTracks().forEach(t => t.stop())
      supabase.removeChannel(ch)
      onClose()
    }

    const makePeer = () => {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcRef.current = pc
      localRef.current?.getTracks().forEach(t => pc.addTrack(t, localRef.current!))
      pc.onicecandidate = e => { if (e.candidate) send('ice', { cand: e.candidate.toJSON() }) }
      pc.ontrack = e => {
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0]
        }
        setConnected(true)
        setStatus('')
      }
      return pc
    }

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 960, height: 540, facingMode: 'user' }, audio: true,
        })
        localRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
      } catch {
        setStatus('Camera/mic blocked')
        setTimeout(cleanup, 1800)
        return
      }

      ch.on('broadcast', { event: 'accept' }, async ({ payload }: any) => {
        if (role !== 'caller' || payload?.from === myId) return
        clearInterval(ringTimerRef.current)
        clearTimeout(timeoutRef.current)
        setStatus('Connecting…')
        const pc = makePeer()
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send('offer', { sdp: pc.localDescription })
      })
      ch.on('broadcast', { event: 'offer' }, async ({ payload }: any) => {
        if (role !== 'callee' || payload?.from === myId) return
        const pc = makePeer()
        await pc.setRemoteDescription(payload.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send('answer', { sdp: pc.localDescription })
      })
      ch.on('broadcast', { event: 'answer' }, async ({ payload }: any) => {
        if (payload?.from === myId) return
        await pcRef.current?.setRemoteDescription(payload.sdp)
      })
      ch.on('broadcast', { event: 'ice' }, async ({ payload }: any) => {
        if (payload?.from === myId) return
        try { await pcRef.current?.addIceCandidate(payload.cand) } catch {}
      })
      ch.on('broadcast', { event: 'decline' }, ({ payload }: any) => {
        if (payload?.from === myId) return
        setStatus(`${otherName} declined`)
        setTimeout(cleanup, 1500)
      })
      ch.on('broadcast', { event: 'hangup' }, ({ payload }: any) => {
        if (payload?.from === myId) return
        setStatus('Call ended')
        setTimeout(cleanup, 900)
      })

      ch.subscribe((s: string) => {
        if (s !== 'SUBSCRIBED') return
        if (role === 'caller') {
          send('ring')
          ringTimerRef.current = setInterval(() => send('ring'), 3000)
          timeoutRef.current = setTimeout(() => { setStatus('No answer'); setTimeout(cleanup, 1800) }, 30000)
        } else {
          send('accept')
        }
      })
    })()

    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function hangUp() {
    chRef.current?.send({ type: 'broadcast', event: 'hangup', payload: { from: myId } })
    setStatus('Call ended')
    setTimeout(() => {
      // cleanup runs through the effect teardown → onClose
      closedRef.current = false
      onClose()
    }, 300)
  }

  function toggleMic() {
    const track = localRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMicOn(track.enabled)
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black flex items-center justify-center">
      {/* them, full screen */}
      <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-contain" />
      {/* me, picture-in-picture */}
      <video ref={localVideoRef} autoPlay playsInline muted
        className="absolute bottom-24 right-3 w-28 rounded-xl border border-white/30 shadow-2xl object-cover" />

      <div className="absolute top-4 inset-x-0 text-center pointer-events-none">
        <p className="text-white font-bold text-sm" style={{ textShadow: '0 1px 4px #000' }}>📹 {otherName}</p>
        {status && <p className="text-gray-300 text-xs mt-1 animate-pulse" style={{ textShadow: '0 1px 4px #000' }}>{status}</p>}
      </div>

      <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-4">
        <button onClick={toggleMic}
          className={`w-12 h-12 rounded-full flex items-center justify-center text-lg border ${micOn ? 'bg-gray-800/90 border-gray-600 text-white' : 'bg-red-900/80 border-red-600 text-red-300'}`}
          aria-label={micOn ? 'Mute mic' : 'Unmute mic'}>
          {micOn ? '🎤' : '🔇'}
        </button>
        <button onClick={hangUp}
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-2xl text-white shadow-xl"
          aria-label="Hang up">
          ✆
        </button>
      </div>

      {connected && null}
    </div>
  )
}
