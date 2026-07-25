import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import OrganizePsubs from '@/components/OrganizePsubs'

// /boards/organize — reorder the boards scroll and switch pSubs on/off
// (Michael). The list mirrors exactly what the deck's strip would show:
// the featured pSubs plus the player's subscribed boards.

const BASE_TABS = ['all', 'videos', 'politics', 'democrats', 'republicans', 'sports', 'space', 'movies', 'ufos', 'random-facts']

export default async function OrganizeBoardsPage() {
  const { userId } = await auth()
  const admin = createSupabaseAdminClient()

  let prefs: { order?: string[]; hidden?: string[] } | null = null
  let subTabs: string[] = []
  let signedIn = false
  if (userId) {
    const { data: prof } = await admin.from('profiles')
      .select('id, board_tab_prefs')
      .eq('clerk_user_id', userId).maybeSingle()
    if (prof) {
      signedIn = true
      prefs = (prof.board_tab_prefs as any) ?? null
      const { data: subs } = await admin.from('board_subscriptions')
        .select('boards(slug)')
        .eq('profile_id', prof.id)
        .order('created_at')
      subTabs = (subs ?? []).map((s: any) => s.boards?.slug).filter(Boolean)
    }
  }

  const initialTabs = [...BASE_TABS, ...subTabs.filter(t => !BASE_TABS.includes(t))]
  return <OrganizePsubs initialTabs={initialTabs} prefs={prefs} signedIn={signedIn} />
}
