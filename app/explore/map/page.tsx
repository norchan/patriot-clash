import { redirect } from 'next/navigation'

// The battle map moved to its own top-level URL.
export default function OldMapRedirect() {
  redirect('/battlemap')
}
