'use client'
import { useState, useEffect, useRef } from 'react'

// Daily step tracking, two independent sources fused together:
//
//  1. MOTION (pedometer): peak detection against a smoothed baseline. The
//     old version compared consecutive ~60Hz samples, whose delta while
//     walking is tiny — that's why a walk around the block counted ~20
//     steps. Peaks vs a running average catch real strides.
//  2. GPS (distance): while the app is open (map on a walk), distance
//     between location fixes converts to steps (~1.31 steps per meter).
//     This backstops phones that throttle motion events.
//
// Today's count = max(motion, gps) per day, persisted in localStorage under
// a date-stamped key → survives navigation, resets automatically at
// midnight. Server keeps the authoritative per-day record and awards FP.
// Web limitation: nothing counts while the phone is locked or the app is
// backgrounded — the profile card says so.

const dayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const STEPS_PER_METER = 1.31

export function useSteps() {
  const [steps, setSteps] = useState(0)
  const [fpEarned, setFpEarned] = useState(0)
  const S = useRef({
    day: dayKey(),
    motion: 0,       // pedometer-detected steps today
    gpsMeters: 0,    // GPS-accumulated meters today
    serverBase: 0,   // best count the server already has for today
    lastSync: 0,
  })

  const currentCount = () => {
    const s = S.current
    return Math.max(s.motion, Math.round(s.gpsMeters * STEPS_PER_METER), s.serverBase)
  }

  const persist = () => {
    const s = S.current
    try {
      localStorage.setItem(`stepsv2_${s.day}`, JSON.stringify({ motion: s.motion, gpsMeters: s.gpsMeters }))
    } catch {}
  }

  const rolloverIfNeeded = () => {
    const s = S.current
    const k = dayKey()
    if (k !== s.day) {
      s.day = k
      s.motion = 0
      s.gpsMeters = 0
      s.serverBase = 0
      s.lastSync = 0
      setSteps(0)
    }
  }

  const refresh = () => setSteps(currentCount())

  // Load today's persisted counts + reconcile with the server record
  useEffect(() => {
    const s = S.current
    try {
      const saved = JSON.parse(localStorage.getItem(`stepsv2_${s.day}`) || 'null')
      if (saved) {
        s.motion = saved.motion || 0
        s.gpsMeters = saved.gpsMeters || 0
      }
    } catch {}
    refresh()
    fetch('/api/steps')
      .then(r => r.json())
      .then(d => {
        const rec = (d.steps ?? []).find((x: any) => x.record_date === s.day)
        if (rec?.step_count) {
          s.serverBase = rec.step_count
          s.lastSync = rec.step_count
          refresh()
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pedometer: peak detection vs a smoothed gravity baseline ──────────────
  useEffect(() => {
    let ema = 9.81          // running average magnitude (≈ gravity at rest)
    let armed = true        // re-arms after magnitude falls back near baseline
    let lastStepAt = 0

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity
      if (!acc) return
      const mag = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2)
      ema = ema * 0.9 + mag * 0.1
      const dev = mag - ema
      const now = Date.now()
      // A stride shows as a peak ~1-4 m/s² above the smoothed baseline
      if (armed && dev > 1.1 && now - lastStepAt > 280) {
        armed = false
        lastStepAt = now
        rolloverIfNeeded()
        S.current.motion += 1
        persist()
        refresh()
      } else if (!armed && dev < 0.3) {
        armed = true
      }
    }

    if (typeof (DeviceMotionEvent as any)?.requestPermission === 'function') {
      (DeviceMotionEvent as any).requestPermission()
        .then((p: string) => { if (p === 'granted') window.addEventListener('devicemotion', handleMotion) })
        .catch(() => {})
    } else {
      window.addEventListener('devicemotion', handleMotion)
    }
    return () => window.removeEventListener('devicemotion', handleMotion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── GPS distance: walking with the app open counts even if motion events
  //    are throttled ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    let last: { lat: number; lng: number; t: number } | null = null

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords
        const now = Date.now()
        if (accuracy && accuracy > 35) return          // too fuzzy to trust
        if (!last) { last = { lat, lng, t: now }; return }
        const dt = (now - last.t) / 1000
        if (dt < 3) return
        const dLat = (lat - last.lat) * 111_320
        const dLng = (lng - last.lng) * 111_320 * Math.cos(lat * Math.PI / 180)
        const meters = Math.sqrt(dLat * dLat + dLng * dLng)
        const speed = meters / dt
        last = { lat, lng, t: now }
        // Human on foot: 0.4–2.6 m/s. Slower = GPS jitter, faster = driving.
        if (meters < 2 || speed < 0.4 || speed > 2.6) return
        rolloverIfNeeded()
        S.current.gpsMeters += meters
        persist()
        refresh()
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Server sync: every 45s when there's something new ─────────────────────
  useEffect(() => {
    const sync = async () => {
      rolloverIfNeeded()
      const count = currentCount()
      if (count - S.current.lastSync < 10) return
      try {
        const res = await fetch('/api/steps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps: count, date: S.current.day }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.fp_awarded > 0) setFpEarned(prev => prev + data.fp_awarded)
          S.current.lastSync = count
        }
      } catch {}
    }
    const iv = setInterval(sync, 45 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { steps, fpEarned }
}
