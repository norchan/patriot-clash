// Bot DM replies via OpenAI. When a human messages a bot, the bot answers in
// character: casual small talk in texting style, wraps the conversation up
// after a handful of exchanges, and quietly blocks anyone who gets nasty.
// Runs post-response via next/server after() so sends stay instant.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Michael's kill switch (2026-07-20): stops bot DM replies. Turned back ON
// 2026-07-22 (Michael: bots should reply to direct messages again).
const BOT_REPLIES_PAUSED = false

export async function generateBotReply(admin: any, botId: string, humanId: string, convId: string) {
  try {
    if (BOT_REPLIES_PAUSED) return
    if (!process.env.OPENAI_API_KEY) return

    const { data: bot } = await admin
      .from('profiles')
      .select('id, username, party, clerk_user_id')
      .eq('id', botId)
      .maybeSingle()
    if (!bot?.clerk_user_id?.startsWith('bot')) return

    const { data: history } = await admin
      .from('direct_messages')
      .select('sender_id, content, image_url, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(14)
    const msgs = (history ?? []).reverse()
    // Only count the bot's replies in the last 8 hours — after 3, it snoozes
    const since = Date.now() - 8 * 3600 * 1000
    const recentBotReplies = msgs.filter((m: any) =>
      m.sender_id === botId && new Date(m.created_at).getTime() > since).length

    // Snoozed: 3 replies in the last 8h is the cap — go quiet
    if (recentBotReplies >= 3) return

    const persona = `You are ${bot.username}, a regular person chatting in the DMs of a mobile game. Reply SHORT and natural, like a quick text — usually just a few words, one sentence max, lowercase is fine, an emoji sometimes. Keep it light and friendly: small talk, "haha", "what's up", "nice", that kind of thing. Do NOT talk about politics. Don't be formal, don't write paragraphs, don't ask lots of questions. Never share contact info, never arrange to meet up, nothing sexual, and don't reveal you're an AI.
IMPORTANT: if the user is hostile, abusive, hateful, or creepy toward you, reply with exactly the single word BLOCK and nothing else.`

    const chat = msgs.map((m: any) => ({
      role: m.sender_id === botId ? 'assistant' : 'user',
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
        max_tokens: 40,
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
        .upsert({ blocker_id: botId, blocked_id: humanId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
        .then(() => {}, () => {})
      return
    }

    // Type like a human, then send
    await sleep(1500 + Math.random() * 2500)
    await admin.from('direct_messages').insert({
      conversation_id: convId,
      sender_id: botId,
      receiver_id: humanId,
      content: reply.slice(0, 400),
    })

    const { notify } = await import('@/lib/notify')
    await notify(admin, {
      profileId: humanId,
      type: 'dm',
      title: `💬 ${bot.username}`,
      body: reply.slice(0, 120),
      link: `/messages/${botId}`,
      dedupeUnreadLink: true,
    })
  } catch (err) {
    console.error('generateBotReply failed:', err)
  }
}
