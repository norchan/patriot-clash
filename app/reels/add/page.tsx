import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import AddReel from '@/components/AddReel'

// /reels/add — link, upload, or record a reel (Michael). Signed-in only;
// guests route through sign-up and come straight back.

export default async function AddReelPage() {
  const { userId } = await auth()
  if (!userId) redirect(`/sign-up?redirect_url=${encodeURIComponent('/reels/add')}`)
  return <AddReel />
}
