import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { sendBotReplyNow } from '@/lib/bot-chat'

// BOT DM QUEUE (Michael 2026-07-25): after 3 minutes of conversation, bot
// replies wait ~20 minutes each. generateBotReply enqueues into
// bot_dm_queue; this route (pg_cron, every 5 min) delivers what's due.

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const { data: due } = await admin
    .from('bot_dm_queue')
    .select('conversation_id, bot_id, human_id')
    .lte('due_at', new Date().toISOString())
    .limit(25)

  let sent = 0
  for (const row of due ?? []) {
    // claim first so an overlapping run can't double-send
    await admin.from('bot_dm_queue').delete().eq('conversation_id', row.conversation_id)

    const [{ data: bot }, { data: human }] = await Promise.all([
      admin.from('profiles').select('id, username, party, clerk_user_id').eq('id', row.bot_id).maybeSingle(),
      admin.from('profiles').select('id, party').eq('id', row.human_id).maybeSingle(),
    ])
    if (!bot?.clerk_user_id?.startsWith('bot')) continue
    // party may have switched since it was queued — bots stay same-party only
    if (!human || human.party !== bot.party) continue

    try {
      await sendBotReplyNow(admin, bot, row.human_id, row.conversation_id)
      sent++
    } catch (err) {
      console.error('bot-dms delivery failed:', row.conversation_id, err)
    }
  }

  return NextResponse.json({ due: (due ?? []).length, sent })
}
