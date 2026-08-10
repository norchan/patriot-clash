import { redirect } from 'next/navigation'

// The creator-earnings / affiliate program is SHELVED (Michael 2026-08-10:
// "hide the affiliate program stuff. No need for that no matter what") — it
// promised cash tied to ad revenue that doesn't exist. The page now bounces
// home; the old enrollment UI lives in git history if it ever comes back.
export default function MakeMoneyPage() {
  redirect('/profile')
}
