# Pic Hunt — Dive Bar

**Source:** `source.jpg`  
**Variants:** `diff-01.jpg` … `diff-10.jpg` (6 intended object-level changes each)

> AI edits are imperfect. Use this as the **design key** (what we asked for).  
> Always human-verify before putting a puzzle live — mark actual differences if the model drifted.

Change types used (bar-style): **remove, move, replace object, count change, pose/state, position** — not “recolor a random pile.”

---

## diff-01
1. Dog under table removed  
2. Cowboy hat moved from wall hook → back of a bar stool  
3. Clock shows ~10:40 (was ~9:15)  
4. Mop replaced with push broom  
5. Waitress tray has **4** beers (was 3)  
6. One fewer dart in dartboard  

## diff-02
1. Tip jar empty (no cash)  
2. Pool cue missing  
3. EXIT sign removed  
4. Second baseball bat added (crossed / extra on wall)  
5. Spilled napkin on floor gone  
6. Dancing couple now standing/talking (not dancing)  

## diff-03
1. Ceiling fan missing one blade  
2. Fire extinguisher moved to opposite wall  
3. Pretzels bowl → popcorn bowl  
4. Ketchup bottle missing (mustard remains)  
5. One bar customer removed (stool empty)  
6. Calendar red circle on a different day  

## diff-04
1. String lights missing  
2. Peanut bucket tipped over / spilled  
3. TV shows basketball (was football)  
4. Coat rack: one fewer jacket  
5. Framed jersey → framed hockey stick  
6. Bartender holds wine bottle (not pouring beer)  

## diff-05
1. Neon sign different silhouette/brand shape  
2. Cue ball missing from pool table  
3. Small American flag added on bar  
4. Dog/cat under table changed (remove dog or add cat)  
5. One dart stuck in wall beside board  
6. Waitress tray holds pizza (not beers)  

## diff-06
1. Ceiling fan spin state changed (blurred ↔ still)  
2. Second tip jar added  
3. Fire extinguisher removed  
4. One bar customer now wearing a baseball cap  
5. Pickle added to burger plate  
6. Mop/broom leans opposite direction  

## diff-07
1. Clock removed from wall  
2. “OPEN” sticker on jukebox  
3. Pool cue broken in half on table  
4. Only two people at bar (was three)  
5. Floor napkin → crumpled receipt  
6. Cowboy hat → construction hard hat on same hook  

## diff-08
1. Liquor shelf missing one bottle (gap)  
2. Dog has bandana/collar  
3. Calendar shows different month  
4. Chalkboard specials board added on wall  
5. One pool ball on the floor  
6. Dancing couple missing  

## diff-09
1. Waitress missing; tray on a table  
2. Guitar on stand by jukebox  
3. Bowl of limes on bar  
4. Peanut bucket removed  
5. One stool tipped over  
6. TV off (black screen)  

## diff-10
1. Mirror shows extra person not in room  
2. Clock reads 6:00 (hands vertical)  
3. Coat rack removed  
4. Burger → pizza slice on plate  
5. Dartboard → square target  
6. Small potted cactus on bar end  

---

## Game design notes for Claude / product

- **Hard mode:** show source + one diff; player taps 6 spots; 60–90s timer.  
- **Scoring:** +points per correct, − for wrong tap, bonus if all 6.  
- **Don’t accept pure recolors** as valid puzzle design — object/count/pose only.  
- After AI generate, **human QA**: open source + diff side by side and list real diffs; update this key.  
- Prefer baking **one intentional change list** into JSON for the client:

```json
{
  "id": "dive-bar-01",
  "source": "/pic-hunt/source.jpg",
  "variant": "/pic-hunt/diff-01.jpg",
  "differences": 6,
  "hints": ["animal under table", "hat location", "clock time", "cleaning tool", "tray count", "darts"]
}
```
