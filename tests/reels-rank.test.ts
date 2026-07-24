import { describe, it, expect } from 'vitest'
import { rankReels } from '@/lib/reels-rank'

// Pins the v1 reels ordering contract (A1 brief Phase 4): recency-first,
// light score boost, optional party tilt, seen items demoted to the tail.

const hoursAgo = (h: number) => new Date(Date.now() - h * 3.6e6).toISOString()

describe('rankReels', () => {
  it('fresh beats old at equal score', () => {
    const out = rankReels([
      { id: 'old', created_at: hoursAgo(30), score: 5 },
      { id: 'fresh', created_at: hoursAgo(1), score: 5 },
    ])
    expect(out[0].id).toBe('fresh')
  })

  it('big engagement can lift a slightly older clip', () => {
    const out = rankReels([
      { id: 'quiet', created_at: hoursAgo(2), score: 0 },
      { id: 'hot', created_at: hoursAgo(6), score: 900 },
    ])
    expect(out[0].id).toBe('hot')
  })

  it('seen clips sink to the tail regardless of score', () => {
    const out = rankReels([
      { id: 'seen-hot', created_at: hoursAgo(1), score: 999 },
      { id: 'unseen-quiet', created_at: hoursAgo(20), score: 0 },
    ], { seenIds: new Set(['seen-hot']) })
    expect(out[0].id).toBe('unseen-quiet')
    expect(out[1].id).toBe('seen-hot')
  })

  it('party tilt breaks near-ties toward the viewer party, gently', () => {
    const out = rankReels([
      { id: 'rep', created_at: hoursAgo(3), score: 3, party: 'republican' },
      { id: 'dem', created_at: hoursAgo(3), score: 3, party: 'democrat' },
    ], { party: 'democrat' })
    expect(out[0].id).toBe('dem')
  })
})
