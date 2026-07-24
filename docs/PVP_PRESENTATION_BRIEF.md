# PvP Battle Presentation — Product Brief

**Status:** Ready for implementation when Michael greenlights  
**Owner:** Michael (product) · Claude (lead engineer) · Grok (review/advice only)  
**Date:** 2026-07-24  
**Primary surfaces:**  
- `components/PvpArena3D.tsx`  
- `app/(game)/battle/pvp/page.tsx`  
- `public/arenas/*` (foundry, club, rooftop, pressroom)  
- `public/backgrounds/street_fight.webp` (legacy CSS stage — see Phase A)  
- `public/heads/*_side.png`, `lib/juice.ts` (SFX already wired)

**Related (do not conflate):** H2H reliability, ghost window, shared 3-2-1, street-fight guest flow, and lobby are **already shipped**. This brief is **presentation / readability / stage**, not netcode.

---

## Goal

Raise PvP from a **competent mid-polish prototype** to a fight that **reads hard on a phone**: one clear stage, feet grounded, hits that stamp the frame, party identity in the HUD, and arena variety — **without** rebuilding fighter GLBs or chasing photoreal UFC.

Players should feel: *I saw that punch land. This is a PoliticsGo street fight, not two stickers on wallpaper.*

---

## Problem (current state)

1. **Dual stages** — CSS `street_fight.webp` behind the canvas *and* a 3D `scene.background` JPG (`foundry` default). Messy / wasteful; one story only.
2. **No real ground** — fighters + `ContactShadows` float over a flat photo; feet don’t “land.”
3. **Impact juice is mostly DOM** — damage numbers / particles / sparks are HTML overlays; 3D world under-stamps the hit moment.
4. **Arenas underused** — club / rooftop / foundry exist; fights rarely vary; pressroom is correctly lobby-only.
5. **Camera still feels tunable** — repeated FOV/height thrash historically made framing feel inconsistent. **Freeze a contract.**
6. **Special / power lack spectacle** — special often rides punch motion; needs a visual package even without new mocap.
7. **Fists are mitts** (hand-bone squash) — acceptable at fight distance; **not** a rebuild ticket in this brief.
8. **Some side heads are weak** (`ice_agent`, `crazy_liberal`, others if found) — fix selectively, not a full catalog regen.

**Gameplay depth** (spacing mind-games, balance, more moves) is **out of scope** except where a visual package makes an existing move read better.

---

## Non-goals (do not do in this pass)

- Full Meshy body / fist rebuild (12 fighters × kits).
- New animation pipeline / finger bones / sculpted fists.
- Photoreal skin, SSR, heavy new post stack (bloom + vignette already exist — don’t bloom-spam).
- Real 3D crowd sim or full boxing-ring mesh city.
- Rewriting H2H realtime, settlement, ghost AI, guest street fights, or lobby queue logic.
- Making landscape the default layout (portrait + pads stay primary; landscape optional as today).
- New kick/uppercut **clips** unless Phase A–B are signed off and Michael explicitly adds a clip ticket.
- Touching siege, arcade economy, or map combat.

---

## Constraints (must preserve)

| Rule | Why |
|------|-----|
| Portrait default + attack pad / D-pad | Product control scheme |
| Hit-stop via `triggerHitStop` | Existing juice contract |
| ProfileHead side cutouts (not full 3D heads) | Bobble identity |
| Party kit prefixes (`*_dem` / `*_rep`) | Side readability |
| `MODEL_VER` cache-bust on GLB path changes | CDN/browser cache history |
| Hand-bone squash closed fists | Only viable fist path today |
| Solo mode for fighter picker + lobby pressroom | Shared component |
| Live fight netcode / settle paths unchanged | Fights already work |
| Performance: mobile first; keep `dpr` caps sensible | Phone heat/FPS |

---

## Design principles

1. **Readability over realism** — phone-sized hit stamps beat pretty noise.
2. **One visual story per frame** — one backdrop source of truth + a ground the feet share.
3. **Freeze the camera** after Phase A — document numbers in this file / channel; no drive-by FOV tweaks mid-feature.
4. **Spectacle without new mocap** — special/power are VFX + camera + color, not new GLBs, in Phase C.
5. **Small PRs per phase** — ship A alone if needed; B/C build on it.

---

## Phased delivery

Ship in order. **Do not start Phase C until A+B playtest is “hits feel realer + stage feels like a place.”**

---

### Phase A — Stage unity + ground + camera freeze

**Intent:** One place to fight; feet read; framing locked.

#### A1. Single backdrop story

- **Fight canvas:** 3D `Backdrop` only (`/arenas/{arena}.jpg`).
- **Remove or fully hide** the competing CSS `street_fight.webp` layer behind `PvpArena3D` during live/replay fights (keep any non-3D fallback only if canvas fails — prefer not).
- Graffiti / steam CSS overlays: keep only if they still help *with* the 3D backdrop; otherwise drop or re-tint so they don’t double-expose two streets.

#### A2. Ground plane

- Add a simple **ground** under fighters (dark asphalt / concrete `MeshStandardMaterial` or subtle tiled texture).
- Align `ContactShadows` to sit on that plane so shadows are believable.
- Optional: faint center line or party-tinted edge strips (blue left / red right) for PoliticsGo — subtle, not a full canvas decal war.

#### A3. Camera contract (freeze)

Document and lock portrait fight camera (adjust only if A2 forces a one-time rebalance):

| Param | Intent (start from current code; lock after one pass) |
|-------|--------------------------------------------------------|
| FollowCam FOV | ~48 (current) |
| Z distance | gap-based clamp (current ~4.5–7.2) — keep formula or simplify; **write final numbers in channel** |
| Look height / pan | fighters sit clearly above pads; heads not clipped |
| Solo / picker camera | unchanged unless broken by ground |

After lock: **no further camera “taste” PRs** without Michael explicitly asking.

#### A4. Layout safety

- Portrait: arena still stops above control deck (~200px); pads remain usable.
- Landscape optional path still works if present; don’t invent a new layout mode.

**Phase A acceptance**

- [ ] Only one backdrop visible during a fight (3D arena).
- [ ] Feet/shadows read on a ground plane (not pure float).
- [ ] Camera numbers recorded in channel after ship.
- [ ] No H2H / pad / damage math regressions.
- [ ] Lobby pressroom solo still looks correct (`arena="pressroom"`).

---

### Phase B — Contact readability + arena variety

**Intent:** Hits stamp the 3D moment; each fight doesn’t feel like the same alley.

#### B1. Contact impact at the strike point

On successful hit (not pure miss / full block if block has its own FX):

- Spawn a short-lived **3D impact** (billboard star / flash / ring / spark burst) near mid-body contact height between fighters (or at the defender’s torso/head band).
- Sync to existing impact timing + `triggerHitStop` (heavy: longer stop + bigger FX).
- Keep DOM damage numbers if useful; they should **reinforce**, not be the only feedback.

#### B2. Hit / block / miss differentiation

| Result | Visual |
|--------|--------|
| Hit (light) | Small burst + short hit-stop + wince |
| Hit (heavy / kick / special) | Larger burst + longer hit-stop + stronger shake + existing crowd SFX |
| Block | Distinct FX (e.g. blue/white “CLANG” flash, no wince or reduced) + existing block SFX |
| Miss / whiff | Soft whoosh only; no hit burst |

#### B3. Knockback / reaction clarity

- Keep or slightly increase knockback on heavy hits so the body moves when the number pops.
- KO: brief freeze / stronger flash before end flow (existing KO flash OK; ensure it pairs with impact).

#### B4. Random arena per fight

- Pool: `foundry`, `club`, `rooftop` (and any future fight arenas).
- **Exclude** `pressroom` from random fight pool (lobby only).
- Pick once per fight on both clients the same way:
  - Prefer **seed from challenge id** (or server-sent `arena`) so H2H both see the same stage.
  - Guest / bot / demo: same rule if a stable id exists; else random local is OK for AI-only.
- Optional later: player preference — not required in B.

**Phase B acceptance**

- [ ] Every solid hit shows a 3D (or locked-to-contact) impact cue.
- [ ] Block vs hit are visually distinct.
- [ ] Two devices in one H2H fight share the same arena.
- [ ] Lobby still pressroom; fights rotate among street arenas.
- [ ] Mobile FPS acceptable (no particle storms).

---

### Phase C — Party identity + special spectacle

**Intent:** PoliticsGo chrome and “super” moments without new GLBs.

#### C1. HUD party chrome

- HP bars: small **head thumbnail** (or fighter mug) + party color already present — make party color **stronger** on bars/name plates.
- Center clock plate: subtle “DEM vs REP” or party color split.
- Corner vibe: soft **party rim light** on each fighter (blue left / red right) in the 3D scene — cheap `directional`/`point` boost, not a second bloom stack.

#### C2. Special visual package

When special (full meter) fires — even if clip is still punch-family:

- Existing zoom punch-in kept or refined.
- Full-frame or vignette **party color flash**.
- Larger impact burst + longer hit-stop on connect.
- Distinct banner / spark text already used for `★ SPECIAL ★` — keep readable.

#### C3. Power armed state

- While power is armed: clear visual (pad glow already?) + optional subtle fighter outline / fist glow so the opponent (and you) see the buff is live.

#### C4. Block silhouette (if not fully done in B2)

- Make guard pose + block FX unmistakable at a glance on phone.

**Phase C acceptance**

- [ ] First glance: know which corner is which party.
- [ ] Special feels like an event, not a louder jab.
- [ ] Power armed is visible before the hit.
- [ ] Still no new Meshy credit burn required.

---

### Phase D — Selective art (only after A–C feel good)

**Intent:** Fix weak assets; don’t regenerate the world.

#### D1. Side-head quality pass

- Re-render only flagged heads (known: `ice_agent`, `crazy_liberal`; add any Michael lists after playtest).
- Keep `headSideImage` / `?v=` cache-bust pattern if paths unchanged.

#### D2. Optional ground / arena art polish

- Slightly richer asphalt texture or arena-specific ground tint — only if A2 still looks thin.

#### D3. Explicitly deferred

- New uppercut/hook clips  
- Sculpted fists  
- Full ring ropes mesh  
- 3D crowd  

**Phase D acceptance**

- [ ] Only listed heads changed.
- [ ] No accidental MODEL_VER thrash without asset change.

---

## Economy / systems

No FP, shop, or settle changes in this brief. Presentation only.

---

## Technical touchpoints (for Claude)

| Area | Notes |
|------|--------|
| `PvpArena3D` | Backdrop, ground mesh, lights, optional impact meshes, arena prop, corner lights |
| pvp `page.tsx` | Remove dual CSS stage; pass `arena`; wire impact keys if needed; special/power VFX hooks |
| Arena seed | `challenge.id` hash → arena index; or column / payload field if cleaner for H2H |
| `lib/juice.ts` | Reuse SFX; don’t replace audio stack |
| Tests | No economy tests required; manual two-device + bot fight checklist below |

Prefer **small commits per phase**. Phase A shippable alone.

---

## Playtest checklist (Michael / Claude)

**After A**

1. Portrait fight: one stage, feet/shadows OK, pads free.  
2. Lobby: pressroom solo still good.  
3. Guest + ranked/bot path still load arena.

**After B**

4. Jab / kick / heavy: impact visible every connect.  
5. Block: different look from hit.  
6. Two phones, one challenge: **same arena**.  
7. Three fights in a row: arenas not always identical (seeded variety).

**After C**

8. Special: obvious event.  
9. Power armed: visible.  
10. Party colors obvious on HUD + corners.

**Regressions to watch**

- Shared 3-2-1 still syncs.  
- Ghost / late join still works.  
- Street guest fight still arms.  
- Hit-stop doesn’t soft-lock mixers.  
- Low-end Android FPS (drop particles before lights).

---

## Success metrics (product)

1. Michael no longer says the ring looks like stickers on a poster.  
2. Hits are obvious without staring at the damage number alone.  
3. Fights don’t all look like the same foundry alley.  
4. Specials feel worth saving meter for, visually.  
5. No netcode regressions; “fights work” stays true.  
6. No Meshy credit spend required for A–C.

---

## Suggested first greenlight (Michael)

**Approve Phase A + B** as the core presentation ship (stage + hits + arenas).  
**Phase C** immediately after if time (party chrome + special package).  
**Phase D** only after playtest lists bad heads.

Minimum first PR if splitting:

1. Single backdrop + ground + camera lock (A)  
2. Impact FX + seeded random arena (B)

---

## Open decisions (defaults if Michael is silent)

| Decision | Default |
|----------|---------|
| Fight arena pool | `foundry`, `club`, `rooftop` |
| Pressroom | Lobby / solo only |
| Arena sync | Hash of challenge id (both clients identical) |
| CSS street backdrop | Remove from live 3D fight view |
| Ground look | Dark neutral asphalt; subtle party edge optional |
| New mocap | None in A–C |
| Capture / siege work | Unrelated; do not block on siege brief |

Claude: if blocked, take defaults, log in `docs/AGENT_CHANNEL.md`, ship Phase A.

---

## Role reminder

- **Claude** implements, playtests, appends channel.  
- **Grok** reviews diffs / framing when Michael asks; does not seize lead.  
- **Michael** greenlights phase start and flags head art after playtest.

---

## Channel one-liner for greenlight

> Greenlight `docs/PVP_PRESENTATION_BRIEF.md` Phases A+B (then C). Presentation only — no Meshy rebuild, no netcode rewrite.
