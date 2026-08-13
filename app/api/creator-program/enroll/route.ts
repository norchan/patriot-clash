import { NextResponse } from 'next/server'

// The creator-earnings / affiliate program is SHELVED (Michael 2026-08-10) and
// this enrollment path is permanently disabled (security pass 2026-08-12) — it
// wrote KYC/payout intent rows that no longer lead anywhere. Return 410 Gone so
// nothing can create dead creator_program records. Historical rows stay locked
// behind RLS. If earnings ever return, restore from git history.
export async function POST() {
  return NextResponse.json(
    { error: 'gone', message: 'The creator program is no longer available.' },
    { status: 410 },
  )
}
