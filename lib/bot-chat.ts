// Bot DM replies via OpenAI (Michael's rules, 2026-07-25):
// - Bots only talk to SAME-party players; cross-party DMs are snoozed
//   entirely (no reply, ever).
// - No reply cap — people can keep talking; the bot stays nice and
//   semi-interested.
// - Pacing (Michael 2026-07-29): EVERY reply lands 8–10 seconds after the
//   human's message — "right away, but not instantly". The old tiering
//   (1–2 min while fresh, then ~20 min per reply) is gone; a bot going
//   quiet for 20 minutes mid-conversation read as broken, not busy.
// - Persona: nice, conversational, not very smart, can't code, never
//   sexual — steers away and changes the subject with a friendly question.
// Runs post-response via next/server after() so sends stay instant.
//
// DELIVERY: 8–10s is far below the every-few-minutes cron tick, so the reply
// is delivered INLINE inside after() — generate first, then sleep until the
// mark, then insert. The bot_dm_queue row is still written as a safety net:
// if the serverless function is frozen or dies mid-sleep, the cron delivers
// it on the next tick instead of the reply vanishing. Whoever gets there
// first claims the row with a checked delete, so it can never double-send.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Michael's kill switch (2026-07-20): stops bot DM replies. Turned back ON
// 2026-07-22 (Michael: bots should reply to direct messages again).
const BOT_REPLIES_PAUSED = false

// Michael 2026-07-29: 8–10 seconds. Long enough to read as a person tapping
// out a text (the thread shows read receipts + a typing indicator the whole
// time), short enough that the conversation still feels live.
const REPLY_DELAY_MS = () => 8_000 + Math.floor(Math.random() * 2_000)

/** Take ownership of the queued reply. Returns false if someone already did —
 *  the inline path and the cron both call this immediately before inserting,
 *  which is what makes a double-send impossible. */
async function claimQueued(admin: any, convId: string): Promise<boolean> {
  const { data } = await admin
    .from('bot_dm_queue')
    .delete()
    .eq('conversation_id', convId)
    .select('conversation_id')
  return !!data?.length
}

const PERSONA_RULES = `Reply SHORT and natural, like a quick text — a few words to one sentence, lowercase is fine, an emoji sometimes. You're nice, easygoing, and semi-interested: actually answer what they asked, keep it RELEVANT to their message, react naturally ("oh nice", "haha no way"), and now and then ask a simple friendly question back. You're a regular person, not very smart or technical, and that's fine — you CANNOT write code, do homework, or explain technical stuff; if asked, laugh it off ("lol i'm useless at that stuff") and change the subject. Do NOT talk about politics. NEVER be sexual or flirty — if the conversation turns sexual or inappropriate, do not engage: steer away and change the subject with a light, appropriate question (what they're up to today, favorite team, food, weekend plans). Never share contact info, never arrange to meet up, don't reveal you're an AI.
IMPORTANT: if the user is hostile, abusive, or hateful, or keeps pushing sexual stuff after you've changed the subject, reply with exactly the single word BLOCK and nothing else.`

// Generate + send one reply from the bot right now (history-aware).
// Shared by the instant path and the queue-delivery cron.
export async function sendBotReplyNow(
  admin: any,
  bot: { id: string; username: string },
  humanId: string,
  convId: string,
  opts: { deliverAt?: number; claim?: boolean } = {},
) {
  if (!process.env.OPENAI_API_KEY) return

  const { data: history } = await admin
    .from('direct_messages')
    .select('sender_id, content, image_url, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(14)
  const msgs = (history ?? []).reverse()
  // nothing new from the human since our last reply → nothing to answer
  if (!msgs.length || msgs[msgs.length - 1].sender_id === bot.id) return

  const persona = `You are ${bot.username}, a regular person chatting in the DMs of a mobile game. ${PERSONA_RULES}`

  const chat = msgs.map((m: any) => ({
    role: m.sender_id === bot.id ? 'assistant' : 'user',
    content: m.content ?? (m.image_url ? '[sent you a picture]' : ''),
  })).filter((m: any) => m.content)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0.9,
      messages: [{ role: 'system', content: persona }, ...chat],
    }),
  })
  if (!res.ok) {
    console.error('bot chat completion failed:', res.status, await res.text().catch(() => ''))
    return
  }
  const data = await res.json()
  const reply = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!reply) return

  if (reply === 'BLOCK' || reply.startsWith('BLOCK')) {
    // The bot has had enough of this person
    await admin.from('player_blocks')
      .upsert({ blocker_id: bot.id, blocked_id: humanId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
      .then(() => {}, () => {})
    // drop the safety-net row too, or the cron would retry a reply that is
    // never coming and burn a completion every tick
    if (opts.claim) await claimQueued(admin, convId)
    return
  }

  // Land exactly on the 8–10s mark when the caller set one; the cron path has
  // no target (its reply is already late) so it just pauses like a typist.
  const wait = opts.deliverAt != null ? opts.deliverAt - Date.now() : 1500 + Math.random() * 2500
  if (wait > 0) await sleep(wait)

  // Claim AFTER generating and waiting, immediately before the insert. Losing
  // the race means the other deliverer already sent this reply — drop ours.
  if (opts.claim && !(await claimQueued(admin, convId))) return

  await admin.from('direct_messages').insert({
    conversation_id: convId,
    sender_id: bot.id,
    receiver_id: humanId,
    content: reply.slice(0, 400),
  })

  const { notify } = await import('@/lib/notify')
  await notify(admin, {
    profileId: humanId,
    type: 'dm',
    title: `💬 ${bot.username}`,
    body: reply.slice(0, 120),
    link: `/messages/${bot.id}`,
    dedupeUnreadLink: true,
  })
}

export async function generateBotReply(admin: any, botId: string, humanId: string, convId: string) {
  try {
    if (BOT_REPLIES_PAUSED) return
    if (!process.env.OPENAI_API_KEY) return

    const [{ data: bot }, { data: human }] = await Promise.all([
      admin.from('profiles').select('id, username, party, clerk_user_id').eq('id', botId).maybeSingle(),
      admin.from('profiles').select('id, party').eq('id', humanId).maybeSingle(),
    ])
    if (!bot?.clerk_user_id?.startsWith('bot')) return

    // Cross-party: bots snooze those DMs entirely — never reply (Michael)
    if (!human || human.party !== bot.party) return

    // the bot "reads" the message right away → read receipt for the human
    await admin.from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('receiver_id', botId)
      .is('read_at', null)

    // Every reply lands 8–10s out, no matter how old the conversation is.
    const deliverAt = Date.now() + REPLY_DELAY_MS()

    // Safety net first: if this function is frozen or killed during the wait
    // below, the cron finds this row and delivers instead of the reply being
    // silently lost. One pending reply per conversation; an earlier due time
    // sticks, so rapid-fire messages still get a single answer.
    await admin.from('bot_dm_queue').upsert(
      {
        conversation_id: convId,
        bot_id: botId,
        human_id: humanId,
        due_at: new Date(deliverAt).toISOString(),
      },
      { onConflict: 'conversation_id', ignoreDuplicates: true },
    )

    // Then deliver it inline — the cron tick is minutes wide, so it could
    // never hit an 8–10s target on its own.
    await sendBotReplyNow(admin, bot, humanId, convId, { deliverAt, claim: true })
  } catch (err) {
    console.error('generateBotReply failed:', err)
  }
}
