// Bot DM replies via OpenAI. When a human messages a bot, the bot answers in
// character: casual small talk in texting style, wraps the conversation up
// after a handful of exchanges, and quietly blocks anyone who gets nasty.
// Runs post-response via next/server after() so sends stay instant.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function generateBotReply(admin: any, botId: string, humanId: string, convId: string) {
  try {
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
    const botMsgCount = msgs.filter((m: any) => m.sender_id === botId).length

    // Already said goodbye — stay gone
    if (botMsgCount >= 8) return

    const stage = botMsgCount < 4
      ? 'Chat casually and stay in character. Keep it light.'
      : botMsgCount < 6
        ? 'Start wrapping the conversation up — you have places to be.'
        : 'Politely end the conversation now (one short goodbye like "gtg, canvassing to do ✌️") and make it final.'

    const persona = `You are ${bot.username}, a ${bot.party === 'democrat' ? 'Democrat' : 'Republican'} player in PoliticsGo, a location-based political battle game. You're chatting in the game's DMs with another player.
Style: casual texting — short (1-2 sentences max), lowercase is fine, occasional emoji, never formal. Talk about the game (town halls, battles, your party crushing the other side), local small talk, light banter. Stay bounded: never share personal contact info, never arrange real-world meetups, never discuss anything sexual, and don't reveal you're an AI — you're just a busy player.
${stage}
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
        max_tokens: 70,
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
