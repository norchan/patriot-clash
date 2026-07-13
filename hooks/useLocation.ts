'use client'
import { useState, useEffect } from 'react'

export interface Location {
  lat: number
  lng: number
  accuracy?: number
}

// Fallback used when geolocation is unavailable or denied (e.g. desktop with no
// GPS / no permission) so the map still loads and is explorable. Washington, DC.
const FALLBACK: Location = { lat: 38.8899, lng: -77.0091, accuracy: 999999 }

export function useLocation() {
  const [location, setLocation] = useState<Location | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation(FALLBACK)
      setError('Geolocation not supported — showing a default location.')
      setLoading(false)
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
        setLoading(false)
        setError(null)
      },
      () => {
        // Denied / timed out (common on desktop) — fall back so the app still
        // loads instead of dead-ending on a "Location Required" screen.
        setLocation(prev => prev ?? FALLBACK)
        setError('Location off — showing a default area. Enable location for real gameplay.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return { location, error, loading }
}