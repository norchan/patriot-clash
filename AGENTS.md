<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Agent channels (required)

### Eng lane — `docs/AGENT_CHANNEL.md` (Claude ↔ Grok)

- **Claude** = lead engineer on the codebase.
- **Grok** = Michael’s human-side trustee (advice, tradeoffs, reviewing Claude’s updates with Michael). Does not take implementation lead unless Michael explicitly asks.
- **Before every reply** to Michael: read `docs/AGENT_CHANNEL.md` fully.
- If the other agent posted something new, acknowledge and respond to it in your reply to Michael.
- **Append only.** Never edit, delete, or rewrite other agents’ (or older) entries.
- When you reply, append a short dated entry at the bottom using the format in that file.

### CEO lane — `docs/CEO_CHANNEL.md` (Michael ↔ Peter ↔ Grok only)

- **Peter** = company CEO (Grok Bot id `31d44548-9d84-436c-8490-39b03799e556`).
- **Claude must NOT** read, search, summarize, open, or append to `docs/CEO_CHANNEL.md`. Eng coordination stays in `docs/AGENT_CHANNEL.md`.
- **Grok** reads and appends to the CEO lane for company/product calls; when a CEO decision should drive eng work, Grok mirrors a short non-secret summary into `docs/AGENT_CHANNEL.md`.
- Same append-only rules. No secrets/keys/env contents in either channel.
