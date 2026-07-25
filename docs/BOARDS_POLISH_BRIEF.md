# Boards Polish — Product Brief + Claude Implementation Prompt

**Status:** Ready when Michael pastes the prompt to Claude  
**Owner:** Michael (product) · Claude (lead engineer) · Grok (review/advice)  
**Date:** 2026-07-24  

Copy the section **“Claude prompt (paste this)”** into Claude Code. The rest of this file is the charter Claude should follow.

---

## Claude prompt (paste this)

```
You are Claude, lead engineer on PoliticsGo (patriot-clash). Read docs/AGENT_CHANNEL.md and append-only when you reply. Read docs/BOARDS_POLISH_BRIEF.md fully and implement it.

## Mission
Make boards feel more like X/Twitter (large media that pops) and enforce hard uniqueness for bot content. Michael’s hard rules:

1. **No bot link post without a real image.** If we can’t get a usable `link_image`, SKIP the post — do not insert a title/domain-only shell.
2. **Images/media must be larger**, X-scale (full content width, max-height ~520–560px on phone), not the current tiny max-h-48/52 cards.
3. **Never show an empty link preview** (title + domain with no image) for bot posts. Prefer: no card at all if no image. Humans may still post text-only text posts; link previews without images should not look like a “broken Twitter card.”
4. **Every bot post, comment, and reply must be unique** — no repeated articles (same link or same story), no near-duplicate comments/replies in a thread or spammy global repeats.

Do NOT rebuild the whole boards product. Do NOT touch PvP, siege, arcade economy, or netcode. Do NOT raise bot volume. Quality over quantity.

## Phase order (ship in order; A+B first if splitting PRs)

### Phase A — No image, no bot link post
- Audit all board/hall news crons that insert `hall_posts` with `link_url`:
  - team-news, state-news, topic-news, local-news, local-events, town-square, video-reels (videos already have thumbs — keep), any others.
- local-news and local-events currently set `link_image: null` — fix them to use `resolveArticle` / `lib/og-image.ts` (or `lib/link-preview.ts`) like team-news.
- After resolve: if no usable https image → **do not insert** the row; log a skip count in the cron JSON response.
- Optional but preferred: one-shot or small backfill for recent bot posts (last 7 days) with `link_url` set and `link_image` null — re-resolve OG; if found, update; if not and profile is a bot (`clerk_user_id` like `bot%`), delete or hide the post so the feed cleans up.
- Human composer path may keep text posts; if a human pastes a link and preview has no image, either compact domain row or soft warning — do not invent fake stock photos.

### Phase B — X-scale media UI
Unify large media across:
- components/BoardsDeck.tsx
- app/p/[board]/page.tsx
- app/p/post/[postId]/page.tsx
- components/HallFeed.tsx LinkCard / image display (same visual language)

Layout rules:
- Full width of content column.
- Hero media max-height ~520–560px (phone), object-cover or contain as appropriate, rounded-2xl, clear border so it lifts off dark bg.
- Link posts: image on top, domain muted + title high-contrast UNDER the image (Twitter-style).
- If `link_image` missing: do NOT render the gray title-only link shell for display of bot-style link cards; for any remaining null-image links show a minimal domain line only or nothing.
- Uploaded `image_url` posts should be at least as large as link heroes.
- Videos: keep p/videos inline player; non-video boards keep big thumb + play badge.
- One hero per card (don’t stack tiny image_url + tiny link_image).

### Phase C — Shared uniqueness for articles
- Extract shared helpers into something like `lib/content-unique.ts` (name free):
  - `sameStory(a, b, ignoreTokens?)` — port the improved team/state logic (strip subject words, ~0.5 token overlap).
  - `normalizeText` for comments.
  - `tooSimilar(a, b, threshold?)` for comments/replies.
- Replace duplicated sameStory copies in team-news, state-news, topic-news (and any other) with the shared helper.
- Every news cron: before insert, skip if same link OR sameStory vs existing titles/links on that board (last 3 days minimum, match current best practice).
- Return skip stats in cron responses.

### Phase D — Unique comments and replies
- board-engagement (app/api/cron/board-engagement/route.ts): before generating, load existing comments on the post; pass them to the model as “do not repeat or paraphrase these”; after generation, if tooSimilar to any existing (or bot’s recent comments), regenerate once; still similar → skip insert.
- hall-replies, hall-reply-replies, hall-chatter, local-buzz, or any other bot comment path: same uniqueness gate.
- Goal: every inserted bot comment/reply is unique enough that a human wouldn’t see copy-paste sludge. Prefer skip over duplicate.

## Constraints
- Server remains authoritative; use existing Supabase admin patterns.
- No raw FP races; this work shouldn’t touch FP.
- Rate limits / cron auth (CRON_SECRET) stay.
- 48h post expiry behavior unchanged unless you only hide/delete bot null-image cleanup.
- Append docs/AGENT_CHANNEL.md when done (append-only).
- Small commits or clear phase commits preferred.

## Acceptance checklist
- [ ] Scrolling boards: almost no “link with no picture” cards from bots.
- [ ] News images feel large / X-like on phone.
- [ ] Link cards with images: big photo, title under image.
- [ ] local-news (and similar) populate link_image or skip.
- [ ] Cron responses report skipped duplicates and skipped no-image.
- [ ] Bot comments on the same post are not near-duplicates.
- [ ] Team/state/topic still post; volume may drop slightly if uniqueness is strict — that’s OK.
- [ ] Human text posts still work.
- [ ] Manual smoke: /boards, p/all, one team psub, one state psub, one post detail with comments.

## Out of scope
- Full X clone (For You algo, communities redesign).
- Raising bot post volume.
- Fake stock photos for every article (branded fallback card ONLY if you need a last resort after skip-first policy — prefer skip).
- PvP, siege, arcade, map combat.

Implement Phases A→D. If you must split, ship A+B first (visible win), then C+D. Log defaults you chose in the agent channel.
```

---

## Background (for humans / Grok review)

### Problems
1. Link previews often have title/domain and **no image** — feels broken vs X.  
2. Media caps (`max-h-48` / `52` / `380`) are too small.  
3. `local-news` / `local-events` set `link_image: null`.  
4. Article sameStory exists on some crons only; comments have **no** uniqueness gate.

### Success
Boards “pop” with large media; bots never spam duplicate stories or comments; empty link shells gone.

### Role
Claude implements; Grok reviews if Michael asks; Michael greenlights by pasting the prompt.
