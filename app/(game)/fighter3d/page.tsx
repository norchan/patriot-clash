import { redirect } from 'next/navigation'

// The 3D picker grew into the full My Fighter designer (body + head) at /fighter.
export default function Fighter3DRedirect() {
  redirect('/fighter')
}
