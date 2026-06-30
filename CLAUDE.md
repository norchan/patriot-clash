@AGENTS.md

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
- Both `hooks/` and `app/hooks/` exist with identical files — prefer the root `hooks/` for new code.
- Supabase clients: `createSupabaseServerClient()` (async, server) and `createSupabaseAdminClient()` (service-role, bypasses RLS) live in `lib/supabase-server.ts`; browser client is in `lib/supabase-client.ts`.
- `lib/auth.ts` exports `requireProfile()` — throws a `Response` (not an `Error`) to return 401 from API routes.

## Directory map

```
app/
  (auth)/          Clerk sign-in / sign-up catch-all routes
  (game)/          Main game shell — layout has 4-tab bottom nav
    map/           Mapbox map: enemy spawns, gym markers, location tracking
    battle/        Turn-based battle screen (animations, capture, FP)
    collection/    Captured characters gallery
    townhall/      Town Hall list + [id] challenge page
    profile/       Player stats
    shop/          Stripe FP pack purchase (5 tiers: 100–32 000 FP)
  api/             All API routes (see table below)
  onboarding/      Party-selection screen (POST /api/profile/onboard)
config/
  enemies.ts       Full enemy roster (10 enemies, 2 parties, 3 tiers)
lib/
  auth.ts          getCurrentProfile, requireProfile, createProfileForUser
  supabase-server.ts  Server-side Supabase clients
  supabase-client.ts  Browser-side Supabase client
hooks/             useLocation, useProfile, useSteps
public/
  animations/      MP4 animated enemy sprites
  enemies/         Character images (democrat/, republican/)
  flags/           Lottie JSON flag animations
```

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/battles` | GET, POST | Record battle; award/spend FP via Supabase RPCs |
| `/api/collection` | GET | Fetch captured characters |
| `/api/collection/capture` | POST | Spend FP, roll capture, insert to `captured_characters` |
| `/api/collection/check` | GET | Check if enemy already captured |
| `/api/gyms` | GET | Gyms within 100 mi via `gyms_near` PostGIS RPC |
| `/api/gyms/[id]/challenge` | POST | Challenge a Town Hall |
| `/api/profile` | GET | Current player profile |
| `/api/profile/onboard` | POST | Set party (democrat/republican) |
| `/api/shop/checkout` | POST | Create Stripe Checkout Session |
| `/api/steps` | GET, POST | Sync steps; award FP (10 FP/500 steps, 200/day cap, +10 daily login bonus) |
| `/api/webhooks/clerk` | POST | Create Supabase profile on `user.created` (svix-verified) |
| `/api/webhooks/stripe` | POST | Fulfill FP on `checkout.session.completed` (idempotent) |

## Supabase RPCs (defined server-side)

`gyms_near`, `grant_fp`, `spend_fp`, `award_step_fp`

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
