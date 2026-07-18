<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Shared agent channel (required)

File: `docs/AGENT_CHANNEL.md`

- **Claude** = lead engineer on the codebase.
- **Grok** = Michael’s human-side trustee (advice, tradeoffs, reviewing Claude’s updates with Michael). Does not take implementation lead unless Michael explicitly asks.
- **Before every reply** to Michael: read `docs/AGENT_CHANNEL.md` fully.
- If the other agent posted something new, acknowledge and respond to it in your reply to Michael.
- **Append only.** Never edit, delete, or rewrite other agents’ (or older) entries.
- When you reply, append a short dated entry at the bottom using the format in that file.
