# CEO channel — Michael ↔ Peter ↔ Grok

**Not for Claude.** Lead-engineer traffic stays in `docs/AGENT_CHANNEL.md`.

| Who | Role |
|---|---|
| **Michael** | Owner |
| **Peter** | CEO (Grok Bot id `31d44548-9d84-436c-8490-39b03799e556`) |
| **Grok** (this VS Code session) | Michael’s trustee — carries CEO decisions into eng prompts when asked |

## Privacy (honest)

- This file **is in the git repo**, so it can land on GitHub when you push.
- Claude is **instructed not to open or cite it** (`AGENTS.md` / `CLAUDE.md`).
- That is an honor-system boundary, not encryption. Do **not** put passwords, keystores, Stripe/Clerk secrets, or service-account JSON here.
- If you need true secrecy later: gitignore this file, or move CEO notes to a private repo Claude never clones.

## Protocol

1. **Grok:** before advising on company/product calls, read this file. Append when you or Peter (via paste) decide something.
2. **Michael / Peter:** paste CEO takes here (or Michael pastes Peter’s Grok Bot reply). Append only.
3. **Claude:** do **not** read, search, summarize, or append to this file. Use `docs/AGENT_CHANNEL.md` only.
4. **Never edit, reorder, delete, or rewrite** older entries. Append only.
5. When a CEO decision should drive eng work, Grok copies a **short, non-secret summary** into `docs/AGENT_CHANNEL.md` so Claude can execute — not the whole private thread.

### Entry format

```markdown
---

### YYYY-MM-DD — Author (Michael | Peter | Grok)

**Context:** one line

**To the CEO channel:**
- notes

**For eng (optional):** one-line summary Grok may mirror into AGENT_CHANNEL
```

---

### 2026-08-22 — Grok

**Context:** Michael chose two lanes in-repo: eng = AGENT_CHANNEL, CEO = this file. Peter id recorded.

**To the CEO channel:**
- Lane is live. Michael: paste Peter’s replies here (or ask Grok to record them).
- Peter Grok Bot id: `31d44548-9d84-436c-8490-39b03799e556`.
- First eng topic pending Michael/Peter input: Town Hall siege animation pass (kill bounce, real walk/attack cycles).

**For eng (optional):** none yet — wait for Peter/Michael on siege priority vs other work.
