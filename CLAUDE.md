@AGENTS.md

## Shared agent channel (required)

Before every reply to Michael, read `docs/AGENT_CHANNEL.md`. Append-only: never edit others’ posts. If Grok (or Michael) added something new, address it when you reply. Claude remains **lead engineer**; Grok is Michael’s human-side trustee. Full protocol is in that file and in `AGENTS.md`. (His name is **Michael** — an early typo made "Micha" stick in old docs; don't repeat it.)

# PoliticsGo — patriot-clash

A location-based AR mobile-web game (think Pokémon Go, US politics edition). Players pick a party (Democrat or Republican), walk the real world, battle opposing-party enemies on a Mapbox map, capture characters, and fight for control of Town Halls. Walking earns FP (Fighting Points); FP is also purchasable via Stripe.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Auth | Clerk (`@clerk/nextjs` v7) |
| Database | Supabase (PostgreSQL + PostGIS) |
| Payments | Stripe (live keys in `.env.local`) |
| Map / AR | Mapbox GL JS v3 |
| Styling | Tailwind CSS v4 (PostCSS-only, no `tailwind.config.*`) |
| Language | TypeScript 5, strict mode |

## Key conventions

- `@/*` path alias maps to the project root.
- `proxy.ts` at the root **is the Clerk middleware** (functions as `middleware.ts`).
- All hooks live in the root `hooks/` directory (the old `app/hooks/` duplicate was removed).
- Supabase clients: `createSupabaseServerClient()` (async, server) and `createSupabaseAdminClient()` (service-role, bypasses RLS) live in `lib/supabase-server.ts`; browser client is in `lib/supabase-client.ts`.
- `lib/auth.ts` exports `requireProfile()` — throws a `Response` (not an `Error`) to return 401 from API routes.

## Directory map

```
app/
  (auth)/          Clerk sign-in / sign-up catch-all routes
  (game)/          Main game shell — bottom-nav layout
    map/           Mapbox map: enemy spawns, hall markers, nearby players, tap-menus
    battle/        Sprite battle vs config enemies (Enemy3D, HP_SCALE 1.4, capture)
    battle/pvp/    Live PvP fight screen (PvpArena3D; portrait default + landscape toggle)
    fighter/ fighter3d/  Fighter builder (body + bobblehead picker, config/heads.ts)
    arcade/        Slots (FP bets) + free games Landslide/TetKris (session-capped FP)
    active/        Active Players — 50 closest matching players, no radius cap
    townhall/      Hall list + [id] page (feed, siege, boost, donate)
    collection/    Captured characters gallery (+ sell-back)
    cliques/       Player groups with feeds
    messages/      DM inbox / threads (image DMs, moderation)
    leaderboard/ notifications/ player/ profile/ settings/ shop/
  api/             ~70 routes (see grouping below)
  explore/         Public crawlable content pages (SEO/AdSense)
  privacy/ terms/  Legal pages (public; required by stores + AdSense)
  onboarding/      Party-selection screen
components/        Enemy3D, PvpArena3D, FighterRig/Sprite, HallFeed, CliqueFeed, …
config/            enemies, heads (bobbleheads v9), slots, attacks, siege-attacks, items, banners
lib/               auth, arcade (anti-farm), ratelimit, pvp, fighter, moderation,
                   blocks, notify, bot-chat, garrison, supabase-server/client
hooks/             useLocation, useProfile, useSteps
scripts/           Meshy character/animation generation, head cutout rendering
                   (render_heads.mjs), hair-weight fixes, hall seeding, QA harnesses
public/heads/      Bobblehead cutout PNGs (?v=9); public/models/ fighter GLBs (?v=3)
public/.well-known/assetlinks.json  Android TWA domain verification
```

## API route groups (all under `app/api/`)

| Group | Routes | Notes |
|---|---|---|
| Economy | `battles`, `collection/*`, `steps`, `items/buy`, `shop/checkout`, `arcade/*` | ALL FP mutations go through Supabase RPCs — never read-modify-write balances |
| Halls | `gyms/*` (challenge/defend/strike/boost/donate/posts/message), `hall-posts/*`, `hall-comments/*` | posts have `party` tags; 48h expiry via pg_cron |
| Social | `chat/*`, `cliques/*`, `posts/*`, `players/*`, `notifications`, `report` | `players/closest` = Active screen; `players/nearby` = map (radius-capped) |
| PvP | `pvp/challenge`, `pvp/pending`, `pvp/[id]/*` | server-validated fight settlement |
| Infra | `webhooks/clerk`, `webhooks/stripe`, `cron/*` (bot content), `public/world`, `avatar/*` | cron routes auth via CRON_SECRET bearer |

Burst rate limits (`lib/ratelimit.ts`, per-instance in-memory): chat send/request, gym challenge/defend/strike, capture.

## Supabase server-side functions

- FP ledger: `grant_fp`, `spend_fp`, `award_step_fp`
- Atomic money paths (added 2026-07-18, one transaction each): `record_arcade_award`
  (session+daily budget clamp under per-profile advisory lock), `slots_settle`
  (bet + win together), `claim_daily_bonus` (claim + grant together)
- Geo: `gyms_near`
- pg_cron: bot content ticks, `expire_hall_posts` (48h, every 10 min), weekly
  `vacuum-halls`, leaderboard refresh. Bot post volume HALVED 2026-07-18 for a
  one-week trial (old schedules in the cron job comments / channel log).

## Tests

`npm test` (vitest) — `tests/economy.test.ts` pins the arcade budget clamp,
slots paytable/RTP, head-catalog gate, and rate limiter. Add a test when
touching economy math.

## Environment variables

See `.env.local` (git-ignored). Required keys:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_FP_100
STRIPE_PRICE_FP_600
STRIPE_PRICE_FP_1400
STRIPE_PRICE_FP_3200
STRIPE_PRICE_FP_32000

NEXT_PUBLIC_MAPBOX_TOKEN
NEXT_PUBLIC_APP_URL
```

## Dev commands

```bash
npm install
npm run dev    # http://localhost:3000
npm run build
npm run lint
```
