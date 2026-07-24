'use client'
import { useEffect } from 'react'

// Stamps the psub you're viewing into session memory so /boards reopens ON
// this psub when you come back (browser back or the ← Boards link) —
// "back to the same spot" (Michael). BoardsDeck reads it on mount.

export default function BoardTabMemory({ slug }: { slug: string }) {
  useEffect(() => {
    try { sessionStorage.setItem('pg_boards_tab', slug) } catch {}
  }, [slug])
  return null
}
