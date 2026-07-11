'use client'
import { useState, useEffect, useRef } from 'react'

// Today's steps live in localStorage under a date-stamped key, so they
// survive navigation and page reloads and reset to zero automatically at
// midnight (the key changes with the local date). The server keeps the
// authoritative per-day record and awards FP.

const dayKey = () => {
  const d = new Date()
  return `steps_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useSteps() {
  const [steps, setSteps] = useState(0)
  const [fpEarned, setFpEarned] = useState(0)
  const stepsRef = useRef(0)
  const lastSyncRef = useRef(0)
  const keyRef = useRef(dayKey())

  // Load today's persisted count on mount
  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(keyRef.current) || '0', 10)
      if (saved > 0) { stepsRef.current = saved; setSteps(saved); lastSyncRef.current = saved }
    } catch {}
    // Reconcile with the server's record for today (another device, cleared storage)
    fetch('/api/steps')
      .then(r => r.json())
      .then(d => {
        const todayStr = keyRef.current.replace('steps_', '')
        const rec = (d.steps ?? []).find((s: any) => s.record_date === todayStr)
        const serverSteps = rec?.step_count ?? 0
        if (serverSteps > stepsRef.current) {
          stepsRef.current = serverSteps
          lastSyncRef.current = serverSteps
          setSteps(serverSteps)
          try { localStorage.setItem(keyRef.current, String(serverSteps)) } catch {}
        }
      })
      .catch(() => {})
  }, [])

  // Pedometer via device motion
  useEffect(() => {
    let lastMagnitude = 0
    let lastStepAt = 0

    const bump = () => {
      // Midnight rollover: if the date key changed, reset to a fresh day
      const k = dayKey()
      if (k !== keyRef.current) {
        keyRef.current = k
        stepsRef.current = 0
        lastSyncRef.current = 0
        setSteps(0)
      }
      stepsRef.current += 1
      setSteps(stepsRef.current)
      try { localStorage.setItem(keyRef.current, String(stepsRef.current)) } catch {}
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity
      if (!acc) return
      const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2)
      const delta = Math.abs(magnitude - lastMagnitude)
      const now = Date.now()
      // Lower threshold + a 250ms refractory window so a single step isn't
      // double-counted and gentle walking still registers
      if (delta > 8 && now - lastStepAt > 250) { bump(); lastStepAt = now }
      lastMagnitude = magnitude
    }

    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      (DeviceMotionEvent as any).requestPermission()
        .then((p: string) => { if (p === 'granted') window.addEventListener('devicemotion', handleMotion) })
        .catch(() => {})
    } else {
      window.addEventListener('devicemotion', handleMotion)
    }
    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [])

  // Sync to the server: every 20 new steps, and on a 60s heartbeat
  useEffect(() => {
    const sync = async () => {
      const s = stepsRef.current
      if (s - lastSyncRef.current < 10) return
      try {
        const today = keyRef.current.replace('steps_', '')
        const res = await fetch('/api/steps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps: s, date: today }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.fp_awarded > 0) setFpEarned(prev => prev + data.fp_awarded)
          lastSyncRef.current = s
        }
      } catch {}
    }
    const iv = setInterval(sync, 60 * 1000)
    return () => clearInterval(iv)
  }, [])

  return { steps, fpEarned }
}
