import { NextResponse } from 'next/server'

// SLOTS REMOVED (Michael 2026-08-12): the game no longer offers slot machines
// (Play content-rating simplification). No bets can be placed. The
// slots_settle SQL function stays locked behind service_role and unused.
export async function POST() {
  return NextResponse.json(
    { error: 'gone', message: 'Slots have been removed from the arcade.' },
    { status: 410 },
  )
}
