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

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) throw new Error('Failed to fetch profile')
      const data = await res.json()
      setProfile(data.profile)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  return { profile, loading, error, refetch: fetchProfile }
}