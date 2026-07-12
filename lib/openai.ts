// Minimal OpenAI chat helper shared by the bot-content crons. Returns the
// assistant text, or null on any failure / missing key (callers no-op).
export async function openaiChat(
  messages: { role: string; content: string }[],
  maxTokens = 60,
  temperature = 0.9,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, temperature, messages }),
    })
    if (!res.ok) {
      console.error('openaiChat failed:', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json()
    return (data?.choices?.[0]?.message?.content ?? '').trim() || null
  } catch (err) {
    console.error('openaiChat error:', err)
    return null
  }
}

// Strip wrapping quotes / hashtags / @mentions that models like to add.
export function cleanPostText(s: string): string {
  return s
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/#\w+/g, '')
    .replace(/@\w+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
