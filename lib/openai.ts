// Minimal OpenAI chat helper shared by the bot-content crons. Returns the
// assistant text, or null on any failure / missing key (callers no-op).
export async function openaiChat(
  messages: { role: string; content: string }[],
  maxTokens = 60,
  temperature = 0.9,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  // Retry rate limits (429) and transient 5xx with backoff — the high-volume
  // hall crons fan out enough concurrent calls to hit the RPM ceiling, and a
  // silent null there means skipped halls.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, temperature, messages }),
      })
      if (res.status === 429 || res.status >= 500) {
        await new Promise(r => setTimeout(r, 700 * (attempt + 1) + Math.random() * 500))
        continue
      }
      if (!res.ok) {
        console.error('openaiChat failed:', res.status, await res.text().catch(() => ''))
        return null
      }
      const data = await res.json()
      return (data?.choices?.[0]?.message?.content ?? '').trim() || null
    } catch (err) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  return null
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
