// Creates the public 'avatars' storage bucket for profile photos.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await sb.storage.createBucket('avatars', {
  public: true,
  fileSizeLimit: 2 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
})
if (error && !`${error.message}`.includes('already exists')) {
  console.error('bucket error:', error.message)
  process.exit(1)
}
console.log('avatars bucket ready', data ?? '(already existed)')
