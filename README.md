# PoliticsGo

A location-based AR mobile-web game — think Pokémon Go, US politics edition.
Players pick a party (Democrat or Republican), walk the real world, battle
opposing-party characters on a live map, capture them, fight for control of
real Town Halls, chat with nearby players, and play FP-earning arcade games.
Political **satire** — both parties get roasted equally. 18+.

**Live:** https://politicsgo.app · **Owner:** PoliticsGo L.L.C. (Michael Smith)

## What's in the game

- **Map** — Mapbox world map with enemy spawns, Town Hall (gym) markers, and
  nearby players. Walking earns FP (Fighting Points) via the pedometer.
- **Battles** — turn-based fights against 3D bobblehead characters; win, then
  spend FP to capture them into your collection.
- **PvP** — build a custom fighter (body + swappable bobblehead), challenge
  other players; real-time 3D fights, portrait-first with a landscape toggle.
- **Town Halls** — real municipal halls as capturable territory, with feeds,
  posts, comments, votes, sieges, boosts, and donations.
- **Arcade** — slots (server-authoritative, FP bets) + free games (Landslide,
  TetKris) that pay FP under anti-farm session caps.
- **Social** — DMs with image support, chat requests, cliques (groups),
  notifications, leaderboard, player profiles with photo albums.
- **Shop** — Stripe checkout for FP packs; steps and daily logins earn FP free.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Clerk auth ·
Supabase (Postgres + PostGIS + pg_cron) · Stripe · Mapbox GL ·
react-three-fiber (3D fighters) · Tailwind v4 · Meshy (character generation)

## Develop

```bash
npm install
npm run dev    # http://localhost:3000 (needs .env.local — see CLAUDE.md)
npm run build  # production build
npm test       # economy/math test suite (vitest)
npm run lint
```

`CLAUDE.md` is the canonical technical map of the codebase (directories, API
routes, database functions, environment variables). `docs/AGENT_CHANNEL.md`
is the shared log between the AI agents working on the project.

## Android

The Play Store app is a TWA wrapper built with Bubblewrap/Gradle; the build
project lives outside this repo at `C:\Users\Micha\politicsgo-android\`
(signing keystore + secrets there too — **backed up, never commit**).
Domain verification is served from `public/.well-known/assetlinks.json`.
