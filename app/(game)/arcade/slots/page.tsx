import { redirect } from 'next/navigation'

// SLOTS REMOVED (Michael 2026-08-12): betting FP on slot machines is
// "simulated gambling" for the Play content rating — pulled from the game to
// keep the rating clean. Full implementation lives in git history.
export default function SlotsGone() {
  redirect('/arcade')
}
