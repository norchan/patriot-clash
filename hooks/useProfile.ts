'use client'
import { useState, useEffect, useCallback } from 'react'

export interface Profile {
  id: string
  clerk_user_id: string
  username: string
  party: 'democrat' | 'republican'
  fp_balance: number
  total_steps: number
  total_battles_won: number
  total_battles_lost: number
  total_gyms_captured: number
  total_captures: number
  rank_title: string
  allow_pvp_messages: boolean
  allow_messages: boolean
  show_party: boolean
  avatar_url: string | null
  clique_id: string | null
  fighter: Record<string, string> | null
}

// Module-level cache so navigating between screens doesn't re-block on
// /api/profile every time — nearly every game page reads the profile, and a
// cold fetch on each mount is what made screens feel slow to load. We serve
// the last-known profile INSTANTLY and revalidate in the background (SWR
// style), and dedupe concurrent fetches into one request.
let cached: Profile | null = null
let inflight: Promise<Profile | null> | null = null

async function loadProfile(force = false): Promise<Profile | null> {
  if (inflight && !force) return inflight
  const p = (async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) throw new Error('Failed to fetch profile')
      const data = await res.json()
      cached = data.profile
      return cached
    } catch {
      return cached // keep whatever we had on a transient failure
    } finally {
      inflight = null
    }
  })()
  inflight = p
  return p
}

export function useProfile() {
  // start from the cache — if we've loaded it once this session the screen
  // paints immediately with no loading flash
  const [profile, setProfile] = useState<Profile | null>(cached)
  const [loading, setLoading] = useState(cached === null)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    const p = await loadProfile(true)
    setProfile(p)
    setLoading(false)
    setError(p ? null : 'Failed to fetch profile')
    return p
  }, [])

  useEffect(() => {
    let alive = true
    if (cached) setProfile(cached) // instant
    loadProfile().then(p => {
      if (!alive) return
      setProfile(p)
      setLoading(false)
      if (!p) setError('Failed to fetch profile')
    })
    return () => { alive = false }
  }, [])

  return { profile, loading, error, refetch }
}
