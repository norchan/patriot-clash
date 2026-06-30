'use client'
import { useState, useEffect, useRef } from 'react'

export function useSteps() {
  const [steps, setSteps] = useState(0)
  const [fpEarned, setFpEarned] = useState(0)
  const lastSyncRef = useRef<number>(0)

  useEffect(() => {
    let stepCount = 0
    let lastMagnitude = 0

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity
      if (!acc) return
      const magnitude = Math.sqrt(
        Math.pow(acc.x || 0, 2) +
        Math.pow(acc.y || 0, 2) +
        Math.pow(acc.z || 0, 2)
      )
      const delta = Math.abs(magnitude - lastMagnitude)
      if (delta > 12) { stepCount++; setSteps(stepCount) }
      lastMagnitude = magnitude
    }

    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      (DeviceMotionEvent as any).requestPermission()
        .then((p: string) => { if (p === 'granted') window.addEventListener('devicemotion', handleMotion) })
        .catch(console.error)
    } else {
      window.addEventListener('devicemotion', handleMotion)
    }

    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [])

  useEffect(() => {
    const syncSteps = async () => {
      if (steps - lastSyncRef.current < 50) return
      try {
        const today = new Date().toISOString().split('T')[0]
        const res = await fetch('/api/steps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps, date: today }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.fp_awarded > 0) setFpEarned(prev => prev + data.fp_awarded)
          lastSyncRef.current = steps
        }
      } catch (err) { console.error('Step sync failed:', err) }
    }

    const interval = setInterval(syncSteps, 15 * 60 * 1000)
    syncSteps()
    return () => clearInterval(interval)
  }, [steps])

  return { steps, fpEarned }
}