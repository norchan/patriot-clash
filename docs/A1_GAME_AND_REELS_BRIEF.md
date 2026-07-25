# A1 Game + Reels Retention — Strategy, Suggestions, Claude Prompt

**Status:** Product charter for Michael · Claude implements when prompt is pasted  
**Owner:** Michael (product) · Claude (lead engineer) · Grok (trustee / review)  
**Date:** 2026-07-24  

---

## Part 1 — Honest overall review (Grok)

### What PoliticsGo already is (strengths)

You have a **real multi-loop product**, not a single-feature demo:

| Pillar | State | A1 gap |
|--------|--------|--------|
| **Map / walk / capture** | Live Mapbox world, enemies, collection | Sprite combat + spawn juice still below Pokémon Go polish |
| **Town halls / territory** | 2,351 halls, party control, donate, siege | Siege least polished (see `SIEGE_REWORK_BRIEF.md`) |
| **PvP** | Live H2H, guest street fights, lobby, presentation pass | Fights “work”; depth + graphics still mid-tier vs top mobile fighters |
| **Boards** | psubs, news bots, large media pass, uniqueness gates | Volume + reels feed not addictive enough yet |
| **Reels** | `/reels` fullscreen swipe, embeds, video-reels cron | **Too few sources, ~2 Shorts/run, sports-heavy, no politics firehose** |
| **Arcade / FP** | Slots, games, Stripe | Anti-farm mostly handled; arcade still not “premium destination” |
| **Social** | Cliques, DMs, bots, politician trackers | Sticky if content is good; thin if feed is empty/dead video |

**Bottom line:** Architecture is ambitious and closer to a real live-service game than most solo projects. It is **not yet A1** because (1) no single loop feels *best-in-class polished*, (2) reels/boards are not yet a daily addiction funnel, (3) graphics identity is strong but consistency and spectacle lag top mobile titles.

### What “A1” means here (realistic bar)

A1 for PoliticsGo is **not** “outspend Niantic.” It is:

1. **One signature loop** people open daily without thinking (reels + map check-in).  
2. **Every session has a dopamine hit in &lt;10 seconds** (video playing, or map with a nearby fight).  
3. **Graphics that look intentional and premium** on a phone — consistent art direction, big media, readable combat, no placeholder junk.  
4. **Content that never feels dead** — boards/reels always full of *unique*, playable, on-theme clips.  
5. **Fair money** — FP integrity, no farm exploits (already mostly true).

### Priority pillars for A1 (recommended order)

| Rank | Focus | Why |
|------|--------|-----|
| **1** | **Reels firehose + reliable playback** | Cheapest retention; “just one more swipe”; guest-friendly |
| **2** | **Boards as X-grade content app** | Already started; keep unique + imageful |
| **3** | **Map first 30 seconds** | Core game identity — enemies, halls, “something to do near me” |
| **4** | **PvP spectacle** | Presentation brief largely done; then *depth* |
| **5** | **Siege** | Territory war — see siege brief |
| **6** | **Arcade polish** | Secondary sink for FP / downtime |
| **7** | **Smart “For You” algorithm** | **Later** — only after inventory is thick and playable |

### Graphics — path to “top mobile” without Hollywood budget

**Do**

- Freeze art contracts (camera, head scale, media sizes) so nothing thrash-regresses.  
- One visual language: dark PoliticsGo chrome, party red/blue, big media, punchy type.  
- Reels: true fullscreen, vertical, snappy swipe (playback bug on phone is **P0** if still black).  
- Combat: impact FX, ground, arena variety (PvP brief).  
- Siege: party units + farmed weapons (siege brief) — theme &gt; ninjas.  
- UI icons / empty states / loading that feel designed, not default gray.

**Don’t**

- Rebuild every Meshy fighter for fists.  
- Re-host TikTok/YouTube files (copyright, ToS, AdSense death).  
- Chase Unreal graphics in a web TWA.

**Honest ceiling:** WebGL + embeds can look *premium mobile* (think high-end web games + TikTok-style reader). It will not match native Unity AAA. Aim for **“best political AR web game / best hybrid game+social”**, not Fortnite.

### Core game loop suggestions (beyond reels)

1. **Daily streak / mission strip** on map: “Walk 1k steps · Win 1 battle · Watch 3 reels · Check your hall” — one screen, big rewards.  
2. **Push that matters:** hall under attack, PvP ready, “new reels for your party.”  
3. **Near me always actionable:** if no enemies, show nearest hall status + “watch reels while you walk.”  
4. **Collection prestige:** rarer captures, showcases — reason to keep walking.  
5. **Party war scoreboard** always visible (you have explore scoreboard — surface it in-app louder).  
6. **Don’t dilute:** finish reels + map juice before inventing new game modes.

### Retention funnel you want

```
Push / share / X link
  → Guest reels (no login) OR guest fight
    → Hooked on swipe / fight
      → Sign up
        → Pick party + fighter
          → Map: capture + hall
            → Daily: reels + walk + one PvP + defend hall
```

Reels and boards are the **top of funnel**. Map/PvP/halls are the **depth**.

---

## Part 2 — Reels: sourcing, bots, algorithm

### Current state (code truth)

- Cron: `app/api/cron/video-reels/route.ts`  
- **10 sports/NASA/highlight channels**, YouTube RSS only  
- **MAX_POSTS = 2** per run, max 1 per channel  
- Dedupe by video id; `videoAvailable` + Shorts filter; OpenAI caption  
- Playback: embed only (`lib/video-embed.ts`) — YouTube + TikTok **if you have a URL**  
- UI: `/reels` fullscreen page (document scroll-snap) after black-screen fixes  

**Problem:** Inventory is thin and **not politics-first**. Thousands of political TikToks exist in the wild, but **you cannot scrape TikTok’s For You feed** reliably/legally from a Vercel cron the way people imagine. Strategy must be: **legal discovery → official embeds → unique posts → thick feed**.

### Hard rules (do not break)

1. **Embed, never re-host** video bytes (YouTube/TikTok ToS + copyright + AdSense).  
2. **Only post if `videoAvailable` / playable in embed.** Dead players destroy trust.  
3. **Unique video ids forever** on p/videos (and preferably global).  
4. **Vertical Shorts/Reels only** for the reels pager (9:16).  
5. **Captions unique** (same uniqueness gates as boards polish).  
6. Prefer skip over junk.

### How to get “all sources” *legally and practically*

| Source | Method | Politics? | Notes |
|--------|--------|-----------|--------|
| **YouTube official channels** | Channel RSS + Shorts filter (current) | Expand list hard | Most reliable on Vercel |
| **YouTube topic / search** | YouTube Data API v3 `search.list` type=video, videoDuration=short, q=politics | **Yes** | Needs API key + quota; best “trending politics” path |
| **Curated politics Shorts channels** | Static allowlist (news orgs, satire, both parties, independents) | **Yes** | Highest quality control |
| **Comedy / viral Shorts** | Allowlist (safe channels) | Indirect | Keeps feed fun |
| **Sports** | Keep subset of current list | No | Don’t let sports dominate politics app |
| **TikTok** | **Only with known video URLs** (oEmbed + player v1) | Ideal when available | No official free trending firehose; scraping login walls is fragile + ToS risk |
| **Humans** | Share-to-PoliticsGo / paste TikTok or Shorts link | Best authenticity | Composer already can post links — promote it |
| **X / Instagram** | Generally **don’t** embed scrape | — | Rights + brittle |

**Recommended mix for bots (target inventory):**

- ~50% politics / news satire / campaign Shorts  
- ~20% funny / viral (safe)  
- ~15% sports / hype  
- ~15% space / science / misc “wow”  
- Always: playable, unique, vertical  

**Volume target (product):**

- Aim **20–40 new reels/day** on p/videos once pipeline is healthy (not 2 every 6h).  
- Cap with quality gates so you don’t fill with unplayable NFL blocks.  
- 48h expiry means you need continuous fill — raise cadence carefully (cost + quota).

### TikTok specifically

- **Do:** support TikTok URLs in composer + bots when URL is known; oEmbed thumb if possible.  
- **Do:** optional “submit a reel” for users (fast path to infinite politics TikToks without scraping).  
- **Don’t:** promise automated “scrape all trending TikTok politics” without a licensed API / partner — it will break weekly and risk the product.  
- **Middle path:** maintain a **curated list of TikTok profile URLs** only if you later add a *compliant* fetch path; until then, YouTube politics Shorts carry the bot firehose.

### “Next video” algorithm

**Michael’s instinct is right: algorithm later.**

| Phase | Behavior |
|-------|----------|
| **Now (v0)** | Chronological `new` + only playable embeds; start at `?start=`; swipe = next in list |
| **Soon (v1 simple rank)** | Score = recency × log(score+1) × party boost (optional) × not-watched; still no ML |
| **Later (v2 For You)** | Watch time, completes, skips, party, topic tags, demote sports if user is politics-heavy |

**Do not block reels growth on ML.** Thick unique inventory + reliable play &gt; clever ranking on 30 videos.

### Playback P0

If phone still shows **black video + audio**, that is higher priority than more sources. A firehose of black screens churns users. Confirm device; finish compositor fix before scaling volume.

---

## Part 3 — Claude prompt (paste this)

```
You are Claude, lead engineer on PoliticsGo (patriot-clash).

Before coding: read docs/AGENT_CHANNEL.md (append-only when you reply) and docs/A1_GAME_AND_REELS_BRIEF.md fully.
Also respect existing briefs if you touch those surfaces:
- docs/BOARDS_POLISH_BRIEF.md (media + uniqueness — already largely shipped; don’t regress)
- docs/PVP_PRESENTATION_BRIEF.md / docs/SIEGE_REWORK_BRIEF.md — DO NOT implement unless Michael explicitly expands scope; this prompt is REELS + retention feed only unless noted.

## Mission
Make PoliticsGo stickier and more A1 by turning **reels into a real firehose** people open daily: many unique, playable, vertical videos from broader sources (especially politics + funny), reliable fullscreen swipe, bots that keep posting without duplicates or dead players.

Michael wants:
1. Bots keep posting reels from many sources — trending, funny, **especially politics Shorts/TikToks**
2. Graphics / presentation top-notch on the reels surface (fullscreen, vertical, premium)
3. Path toward “next video” ranking — but **simple ordering first; smart algorithm later**
4. Never re-host video files (embed only)
5. Every reel post unique; no dead embeds

## Out of scope (this prompt)
- Full game redesign, new AR engine, Meshy fighter rebuilds
- Siege rework, PvP netcode, arcade economy overhaul
- Scraping TikTok For You / Instagram / illegal downloaders
- Complex ML recommendation system (document hooks only; implement simple rank at most)
- Raising hall-bot spam volume

## Phase 0 — Playback trust (P0 if broken)
- Verify /reels on mobile: video visible + audio (not black frame).
- If black-screen still possible, fix compositor/embed approach before scaling volume.
- Keep dead-video sweeper (board-engagement or dedicated) deleting unplayable posts.
- Acceptance: phone can swipe 5 reels with visible picture.

## Phase 1 — Expand legal discovery (YouTube-first firehose)
File: app/api/cron/video-reels/route.ts (or split helpers under lib/reels-*.ts)

1. **Politics-first channel allowlist** — add many official/news/satire/creator channels that regularly upload Shorts (both parties + neutral + comedy). Keep a smaller sports subset so p/videos is not “sports only.”
2. **Raise throughput carefully:** e.g. more posts per run and/or more frequent cron — target roughly **20–40 playable unique Shorts/day** if quality gates pass. Report inserted / skipped_dupe / skipped_not_short / skipped_unplayable / skipped_no_caption.
3. Keep: Shorts-only (vertical), videoAvailable, never repost same video id, unique captions (content-unique / tooSimilar if available).
4. Optional **YouTube Data API** path (if YOUTUBE_API_KEY in env): search recent short politics/funny queries on a quota budget; still run Shorts + embeddable gates. If no key, skip gracefully and document in channel.
5. Mix categories per day (politics / funny / sports / other) so the feed isn’t one topic.

## Phase 2 — TikTok + human firehose (without illegal scrape)
1. Ensure TikTok URLs embed correctly in /reels and feed cards (already partial in lib/video-embed.ts) — thumbs via oEmbed when possible.
2. Bots: only post TikTok when you have a **resolved video URL** and oEmbed/playable check passes. Do NOT build a brittle TikTok trending scraper.
3. **Human path:** make paste/share of YouTube Shorts or TikTok links dead simple on p/videos (and optional “Add a Reel” entry from /reels). Humans are how you get “thousands of politics TikToks” legally.
4. Optional: “Suggested for bots” backlog table later — not required if human+YouTube fill works.

## Phase 3 — Reels product UX (premium feel)
1. /reels: polished chrome — party-aware accents, clear username/caption, swipe hint once, tap zones for pause if feasible within embed limits.
2. Loading skeletons / thumb first so swipe never feels empty.
3. Empty state: “No reels right now — check back soon” + CTA to boards/map, never a broken iframe.
4. Dock/map Reels entry stays one tap into fullscreen swipe.
5. Guest-friendly (already public) — soft sign-up prompt after N swipes (e.g. 8–12), not a wall on first video.

## Phase 4 — Next-video ordering (simple now, algorithm later)
1. **v0/v1:** Build ordered playlist server-side: playable only; prefer newer; lightly boost score; optional party tilt if signed in; deprioritize already-seen if you can store seen ids in localStorage (client) or a lightweight table (server) — localStorage OK for v1.
2. **Do not** build full For You ML. Leave a clear `rankReels(items, ctx)` function so a later algorithm can replace the scorer.
3. Swipe always has a next item until list ends; optional fetch-more if you paginate.

## Phase 5 — Retention hooks (light)
1. After watching, subtle CTAs: “Fight on the map” / “Your town hall” / “Join the party” (signed-out).
2. Optional daily “3 reels” mission only if a missions system already exists or is trivial — do not invent a huge quest engine in this pass.
3. Push copy suggestion in channel (don’t need full push infra rebuild): “New political reels for you.”

## Constraints
- Embed only (youtube-nocookie / TikTok player). No yt-dlp, no stored mp4s of others’ content.
- CRON_SECRET auth on crons; append AGENT_CHANNEL.md when done.
- Prefer skip over bad content.
- Watch OpenAI/YouTube quota cost; log daily insert counts.
- Don’t regress boards uniqueness / large media rules.

## Acceptance checklist
- [ ] p/videos and /reels show a thick vertical feed (many unique playable items), not ~handful of sports shorts
- [ ] Politics and funny content appear regularly alongside (not buried by) sports
- [ ] Bots never repost the same video id; unplayable videos get removed
- [ ] Phone: visible video frames while swiping (not black+audio only)
- [ ] TikTok links work when posted; human paste path documented or obvious in UI
- [ ] rankReels (or equivalent) exists for simple ordering; no fake “AI For You” claim
- [ ] Cron JSON reports skip reasons
- [ ] Channel entry summarizing sources added, volume, and any env keys needed (YOUTUBE_API_KEY)

## Implementation order
Phase 0 → 1 → 2 → 3 → 4 → 5. Ship 0+1 first if splitting. Log defaults in docs/AGENT_CHANNEL.md.
```

---

## Part 4 — What Michael should do (product)

1. **Paste Phase 0–1 first** if phone reels still flaky — trust before volume.  
2. Add **`YOUTUBE_API_KEY`** (Google Cloud, YouTube Data API enabled) when ready for search firehose.  
3. Decide **politics vs sports balance** (recommend 50%+ politics).  
4. **Promote human reel shares** — best TikTok path.  
5. **Algorithm later** — after 100+ playable reels/day of quality.  
6. Parallel (separate prompts): siege brief, map juice, daily missions — don’t put all A1 on Claude in one mega-PR.

---

## Part 5 — Suggested multi-quarter A1 roadmap (not all this prompt)

| Horizon | Focus |
|---------|--------|
| **This sprint** | Reels firehose + playback + simple rank (this brief) |
| **Next** | Map session juice + daily missions strip |
| **Next** | Siege Phase A–B (weapons / no ninjas) |
| **Ongoing** | PvP depth + selective art; arcade premium |
| **Later** | For You algorithm, creator tools, native wrappers if needed |

---

## Role reminder

- **Claude** implements the paste prompt and appends the channel.  
- **Grok** reviews and prioritizes with Michael; does not seize lead.  
- **Michael** greenlights by pasting the prompt (optionally “Phases 0–1 only first”).
