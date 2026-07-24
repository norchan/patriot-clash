# Town Hall Siege Rework — Product Brief

**Status:** Ready for implementation when Michael greenlights  
**Owner:** Michael (product) · Claude (lead engineer) · Grok (review/advice only)  
**Date:** 2026-07-23  
**Primary surfaces:** `app/(game)/battle/siege/page.tsx`, `config/siege-attacks.ts`, `config/items.ts`, `app/api/gyms/[id]/challenge`, `app/api/gyms/[id]/strike`, townhall donate/boost, future farm/inventory APIs  

---

## Goal

Turn the town-hall attack from a **12-second damage-reveal animation with ninjas** into a **PoliticsGo campaign siege**: party-themed units, limited free troops, and **farmed/owned weapons** that actually decide how hard you hit.

Halls should feel like a war you **prepare for** (walk, farm, stockpile), not a spam minigame you open after paying 100 FP.

---

## Problem (current state)

1. **Ninjas are wrong thematically** — CoC-style soldiers, not PoliticsGo.
2. **Outcome is mostly server-predetermined** (challenge rolls ~200–400 DEF for 100 FP); client only spends that budget. Fine for integrity; bad if players think skill decided the win.
3. **No loadout / inventory** — rocks and “firecrackers” are free spam; `config/items.ts` boosts barely own the fight.
4. **Specials are the best part** (pitchforks, eagles, Liberty) and should stay the personality peak.
5. **Defense tug-of-war** (1 FP donate = 1 DEF) is good — keep it.

---

## Non-goals (do not do in this pass)

- Full Clash of Clans base builder (village grid, multi-hour builds, 40 troop types).
- Client-trusted damage or capture (server remains authoritative).
- Polishing ninja run cycles / new ninja art.
- Rewriting hall feed, bots, or PvP.
- 3D siege arena.
- Changing “strikes cannot deliver the killing blow” (defense floors at 1 on `/strike`) unless Michael later reopens it.

---

## Constraints (must preserve)

| Rule | Why |
|------|-----|
| Challenge costs FP via `spend_fp` RPC | Money integrity |
| Damage + capture decided server-side on challenge | Anti-cheat |
| Strikes spend FP server-side from `SIEGE_ATTACKS` | One definition, no client invent |
| Same-party halls not attackable; own hall not attackable | Party war rules |
| Location / range checks stay | Map game |
| Rate limits on challenge/strike stay or tighten | Abuse |
| Bunker / decoy / iron firewall still work | Existing defense items |

---

## Phased delivery

Ship in order. **Do not start Phase C until A+B feel good in playtest.**

### Phase A — Theme + honesty (small, high feel)

**Intent:** Kill the ninja fantasy; make the assault readable; stop unlimited free spam.

#### A1. Replace free “ninjas” with party units

| | Democrat | Republican |
|--|----------|------------|
| Free troop name | Canvassers / Volunteers (pick one product name and stick) | Marshals / Ground Game (pick one) |
| Art direction | Reuse/adapt existing soldier or “poor” frames if needed; **not** black ninja read | Same |
| Behavior | Limited slots per assault (see A2); march → hit → poof; turrets still thin the horde | Same |

- Rename all UI copy, comments, and variable names that say “ninja” in player-facing text.
- Keep placement skill (turret kill chance by proximity) if cheap; optional later.

#### A2. Limited free units per 100 FP assault

- e.g. **5 free volunteers** per challenge (tunable constant).
- No unlimited tap-spam.
- Higher fighter level may slightly improve free-unit HP/damage (existing level scaling can stay, retuned).

#### A3. Honest assault power UI

On **ready** screen, after location OK, show something like:

- Assault cost: **100 FP**
- Expected chip: **server still rolls on begin** — either:
  - **Preferred:** show range “~200–400 DEF” before pay, exact number after challenge returns; or
  - Roll on begin and flash “Assault power: N DEF” for 1s before interact.

Players should never think free units “almost captured” a hall the server already said no on.

#### A4. Free throws stay weak

- Swipe rocks / weak campaign signs = small budget spend only.
- Not the main path to pressure high-DEF halls.

**Phase A acceptance**

- [ ] No player-facing “ninja” copy or ninja fantasy.
- [ ] Free units are capped per assault.
- [ ] Ready/assault UI states cost + that damage is limited / budgeted.
- [ ] Capture math unchanged; still one challenge POST per assault.
- [ ] Playtest: assault feels like a short campaign push, not infinite spawn.

---

### Phase B — Weapons that matter (core of Michael’s farm vision)

**Intent:** Siege power comes from **inventory you own**, not free spam. Farm later feeds this tray.

#### B1. Siege inventory tray

During assault (or loadout pre-assault), show consumables the player owns:

| Item (config already) | Role | Notes |
|----------------------|------|--------|
| Firecracker (or political rename: “Yard Bomb” / “Popper”) | Small burst | Already in `config/items.ts` |
| Dynamite | Mid burst | |
| Rocket | Big wall-breaker | |

Political renames optional in B; numbers can stay as in config until economy pass.

#### B2. Server spends inventory

- Using an item: API validates ownership/count, decrements, applies **server-approved** extra DEF damage (or adds to assault budget — pick one model and document it).
- Client only animates the returned damage.
- Cannot invent items or damage.

Suggested model (Claude may refine if cleaner):

- Challenge still rolls base chip (200–400).
- Each consumed siege item adds fixed damage from `ITEMS` (or new siege table), applied in same transaction or immediate follow-up RPC, still cannot exceed “hall goes to 0 only via challenge path” if current capture rules require it — **preserve capture rules:** final capture remains a challenge victory when remaining ≤ 0 after authoritative updates.

Clarify capture with items:

- **Option 1 (safer, closer to today):** Items only usable during an active challenge window / as strikes-like chips that still floor at 1 unless the challenge budget already includes capture.  
- **Option 2 (better fantasy):** Items deal real DEF; if DEF hits 0 mid-assault, capture. Requires careful atomic update + anti-double-capture.

**Default for this brief: Option 2 if it can be done with one atomic server path; else Option 1 with clear UI.** Document choice in channel when shipping.

#### B3. Wire shop / claim → inventory → tray

- Players can buy or claim daily free firecracker (config already has `DAILY_FREE_ITEM`).
- Inventory visible on townhall or bag, and on siege screen.
- Empty tray + free units only = weak assault (by design).

#### B4. One farm building (minimum viable farm)

**Single producer first** — e.g. **Print Shop** / **Sign Yard**:

| Spec | v1 |
|------|-----|
| Unlock | Free or cheap FP; one per player |
| Output | Lowest-tier siege ammo (signs / firecracker-tier) |
| Rate | Slow + hard cap on stockpile (e.g. max 10–20) |
| Bonus | Optional: walking / step claim multiplies or speeds production slightly |
| UI | Simple card under profile or new “Campaign HQ” strip — not a full city |

No multi-building tree in Phase B.

**Phase B acceptance**

- [ ] Player can hold siege item counts server-side.
- [ ] Using an item in siege spends it and applies server damage.
- [ ] Free-only assault is clearly weaker than stocked assault.
- [ ] One farm structure produces lowest-tier ammo over time with a stockpile cap.
- [ ] Economy tests for spend/grant paths if new RPCs (follow project test norms).
- [ ] No raw `fp_balance` read-modify-write; use existing RPCs patterns.

---

### Phase C — Composition mini-game (only after A+B playtest)

**Intent:** Scarcity + order matter.

- Pre-assault loadout: 3–5 slots (swarm / breaker / airstrike / clear-decoy, etc.).
- Assault length ~20–30s if needed for readability.
- Party specials (`SIEGE_ATTACKS`) become **ultimate slot**: FP and/or rare farmed “PAC” charge.
- Placement still matters because units are scarce.

**Phase C acceptance**

- [ ] Loadout screen before begin.
- [ ] Running out of units/items ends pressure; no infinite free refill.
- [ ] Specials still party-themed and juiced.

---

### Phase D — Holder base (later, out of scope for first greenlight)

- Visible defenses on siege art matching bunker/towers.
- Clique-funded hall upgrades.
- Full “base layout” fantasy.

Do not start D in the first greenlight.

---

## Economy guardrails

1. Production **slow + capped** — no AFK infinite mint.
2. Walking can help farm rate; must not outpace paid FP / shop without caps.
3. Capture reward (today **50 FP**) is weak vs multi-assault cost — **optional follow-up:** raise capture prestige (FP, title, clique bonus) so taking a hall feels worth the campaign. Not required for Phase A.
4. All FP and item mutations: RPCs / atomic SQL; no client-trusted balances.
5. Rate-limit new farm-claim and item-use endpoints.

---

## UX copy direction (PoliticsGo voice)

- Assault, defense, campaign, volunteers, war room — not ninja, clan, goblin.
- Ready: “March on {City} Town Hall — 100 FP”
- Weak stock: “Your campaign is short on supplies — farm or buy gear”
- Capture: party pride + notify previous holder (already exists)

---

## Technical touchpoints (for Claude)

| Area | Path / note |
|------|-------------|
| Siege UI | `app/(game)/battle/siege/page.tsx` |
| Party specials | `config/siege-attacks.ts` + `app/api/gyms/[id]/strike` |
| Challenge | `app/api/gyms/[id]/challenge` |
| Items catalog | `config/items.ts` |
| Hall boosts UI | `app/(game)/townhall/[id]/page.tsx` |
| Art | `public/halls/*`, `public/siege/*` — reskin free troops; specials art is fine |
| New (Phase B) | inventory table or profile JSON columns; farm state; claim/use APIs; tests under `tests/` for economy math |

Prefer **small PRs / commits per phase**. Phase A should be shippable alone.

---

## Success metrics (product)

After A+B:

1. Michael (and playtesters) no longer say “ninjas don’t belong.”
2. Players with stocked weapons clearly out-pressure free-only players.
3. Hall defense donate still matters; fat halls still take multiple marches.
4. No new FP mint bugs; item double-spend impossible under concurrent taps.
5. Siege feels like the **least embarrassing** major loop — on the path to “prepare and attack,” not “tap for 12s.”

---

## Suggested first greenlight (Michael)

**Approve Phase A only** for the first ship, or **A + B1–B3** if inventory already half-exists.

Minimum first PR:

1. Rename/reskin free troops off ninjas.  
2. Cap free units.  
3. Honest assault power / budget UI.  

Then B: tray + server item spend + one Print Shop.

---

## Open decisions (Michael can answer in channel)

1. Free troop names (Dem / Rep).  
2. Capture via items mid-assault: Option 1 (safe floor) vs Option 2 (items can finish hall).  
3. Farm UI home: profile vs townhall vs new Campaign HQ.  
4. Whether to bump capture FP reward in the same pass.

Claude: if blocked on an open decision, pick a temporary default, log it in `docs/AGENT_CHANNEL.md`, and ship Phase A without waiting.

---

## Role reminder

- **Claude** implements and appends channel updates.  
- **Grok** reviews diffs / playtest notes when Michael asks; does not seize lead.  
- **Michael** greenlights phase start and names/open decisions.
