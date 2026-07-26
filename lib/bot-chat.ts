// Bot DM replies via OpenAI (Michael's rules, 2026-07-25):
// - Bots only talk to SAME-party players; cross-party DMs are snoozed
//   entirely (no reply, ever).
// - No reply cap — people can keep talking; the bot stays nice and
//   semi-interested.
// - Pacing: for the first 3 minutes of a conversation the bot replies
//   right away (with a typing delay). After that, each reply waits ~20
//   minutes — queued in bot_dm_queue, delivered by /api/cron/bot-dms.
// - Persona: nice, conversational, not very smart, can't code, never
//   sexual — steers away and changes the subject with a friendly question.
// Runs post-response via next/server after() so sends stay instant.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Michael's kill switch (2026-07-20): stops bot DM replies. Turned back ON
// 2026-07-22 (Michael: bots should reply to direct messages again).
const BOT_REPLIES_PAUSED = false

const FAST_WINDOW_MS = 3 * 60 * 1000   // replies are instant for this long
const SLOW_DELAY_MS = 20 * 60 * 1000   // then each reply waits this long

const PERSONA_RULES = `Reply SHORT and natural, like a quick text — a few words to one sentence, lowercase is fine, an emoji sometimes. You're nice, easygoing, and semi-interested: actually answer what they asked, keep it RELEVANT to their message, react naturally ("oh nice", "haha no way"), and now and then ask a simple friendly question back. You're a regular person, not very smart or technical, and that's fine — you CANNOT write code, do homework, or explain technical stuff; if asked, laugh it off ("lol i'm useless at that stuff") and change the subject. Do NOT talk about politics. NEVER be sexual or flirty — if the conversation turns sexual or inappropriate, do not engage: steer away and change the subject with a light, appropriate question (what they're up to today, favorite team, food, weekend plans). Never share contact info, never arrange to meet up, don't reveal you're an AI.
IMPORTANT: if the user is hostile, abusive, or hateful, or keeps pushing sexual stuff after you've changed the subject, reply with exactly the single word BLOCK and nothing else.`

// Generate + send one reply from the bot right now (history-aware).
// Shared by the instant path and the queue-delivery cron.
export async function sendBotReplyNow(admin: any, bot: { id: string; username: string }, humanId: string, convId: string) {
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
    return
  }

  // Type like a human, then send
  await sleep(1500 + Math.random() * 2500)
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

    // Pacing: instant inside the first 3 minutes of the conversation;
    // after that every reply is queued ~20 minutes out
    const { data: firstMsg } = await admin
      .from('direct_messages')
      .select('created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const convAge = firstMsg ? Date.now() - new Date(firstMsg.created_at).getTime() : 0

    if (convAge > FAST_WINDOW_MS) {
      // one pending reply per conversation — an earlier due time sticks
      await admin.from('bot_dm_queue').upsert(
        {
          conversation_id: convId,
          bot_id: botId,
          human_id: humanId,
          due_at: new Date(Date.now() + SLOW_DELAY_MS).toISOString(),
        },
        { onConflict: 'conversation_id', ignoreDuplicates: true },
      )
      return
    }

    await sendBotReplyNow(admin, bot, humanId, convId)
  } catch (err) {
    console.error('generateBotReply failed:', err)
  }
}
