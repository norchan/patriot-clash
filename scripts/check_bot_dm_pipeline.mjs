// Round-trip check for the bot DM reply pipeline, against the REAL database.
//
//   node scripts/check_bot_dm_pipeline.mjs [humanUsername] [botUsername]
//
// Exists because bot replies died silently for days: bot_dm_queue.conversation_id
// was a uuid column while conversation ids are composite "<uuidA>_<uuidB>"
// strings, so every queue write failed with 22P02 and the app never checked the
// result. Nothing logged, no rows, no replies. This script checks each step's
// error explicitly, which is the whole point -- the production path's habit of
// ignoring write results is what made the bug invisible.
//
// Run it after ANY change to the DM queue, and if bots ever go quiet again.
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

// default pair = the real same-party conversation that went unanswered
const [humanName, botName] = [process.argv[2] || 'WeBeJamin', process.argv[3] || 'IndieEsme']
const { data: human } = await admin.from('profiles').select('id, username, party').eq('username', humanName).maybeSingle()
const { data: bot } = await admin.from('profiles').select('id, username, party, clerk_user_id').eq('username', botName).maybeSingle()
console.log('human:', human?.username, human?.party, human?.id)
console.log('bot  :', bot?.username, bot?.party, bot?.clerk_user_id, bot?.id)
console.log('startsWith bot:', bot?.clerk_user_id?.startsWith('bot'), '| same party:', human?.party === bot?.party)

const convId = [human.id, bot.id].sort().join('_')
console.log('convId:', convId)

// 1. UPSERT — the step whose result production never checks
const up = await admin.from('bot_dm_queue').upsert(
  { conversation_id: convId, bot_id: bot.id, human_id: human.id, due_at: new Date(Date.now() + 9000).toISOString() },
  { onConflict: 'conversation_id', ignoreDuplicates: true },
)
console.log('\nUPSERT status:', up.status, 'error:', up.error ? JSON.stringify(up.error) : 'none')

const { data: after } = await admin.from('bot_dm_queue').select('*').eq('conversation_id', convId)
console.log('row present after upsert:', after?.length ?? 0, JSON.stringify(after))

// 2. CLAIM — the checked delete the reply now depends on
const del = await admin.from('bot_dm_queue').delete().eq('conversation_id', convId).select('conversation_id')
console.log('\nCLAIM status:', del.status, 'error:', del.error ? JSON.stringify(del.error) : 'none')
console.log('claim returned rows:', del.data?.length ?? 0, '→ claimQueued would return', !!del.data?.length)

// 3. Can we even insert a DM as this bot?
const ins = await admin.from('direct_messages').insert({
  conversation_id: convId, sender_id: bot.id, receiver_id: human.id, content: '__diag__ delete me',
}).select('id')
console.log('\nINSERT status:', ins.status, 'error:', ins.error ? JSON.stringify(ins.error) : 'none')
if (ins.data?.[0]?.id) {
  await admin.from('direct_messages').delete().eq('id', ins.data[0].id)
  console.log('(test message inserted OK and removed)')
}
