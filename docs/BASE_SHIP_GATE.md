# Base Crown Jewel — Ship Gate (B10)

Final smoke checklist for the B1–B10 base stack. Automated rows are filled in
by Claude at commit time; ☐ rows are Michael's on-phone pass. Re-run the
automated column after any change to the base (`npx tsc --noEmit`,
`npx vitest run`, `npm run build`, `node` asset audit below).

## Automated (2026-08-16, commit of B10)

- [x] `npx tsc --noEmit` — clean
- [x] `npx vitest run` — 107/107 (economy clamps, slots RTP, head gate, rate limiter)
- [x] `npm run build` — production build compiles clean
- [x] **Asset audit — 0 missing of 183 referenced files**
      (30 house sprites incl. all levels + rubble + fx · 110 troop anim frames
      + 10 static troop cards · 16 SFX WAVs · yard bg + fence/wall set).
      One-liner lives in the channel log; re-run when adding art.

## Michael's phone pass (Pixel-class + one mid phone if handy)

### Home (/hq)

- [ ] Pinch zoom + pan smooth; double-tap fits the lot; no camera fight while dragging a building
- [ ] Tap empty pad → build sheet: gold pulse on the pad, FP shown, broke rows say "Need ⚡N more"
- [ ] Build something → instant, pop-in + place thunk
- [ ] Drag-move a building → ghost snaps to legal pads, red diamond on illegal, refused drop flashes red
- [ ] Menu MOVE flow → green pads, X cancels (Escape on desktop)
- [ ] Upgrade + rush → cost·time on the button, chip shows countdown + progress bar, rush priced
- [ ] Train troops → queue bar ticks, army cap visible, +1/+5 disable when broke or full
- [ ] Claim: print shop bundle, tower/solar FP, yard sparkles → coin jingle + pad pop
- [ ] Wreck-and-repair: damaged building leads with repair card; scorch + smolder visible on the yard
- [ ] Timer finishing while watching → chime + ✨ on the pad
- [ ] 🍃 ambience mute and 🎵 music mute are independent and remembered
- [ ] Hint line shows something sensible; ✕ dismisses

### Raid (/hq/raid)

- [ ] Deploy: boots sound, troops fan out, 6-frame runs everywhere
- [ ] Chips ≠ breaches ≠ gun cracks by EAR alone; L3 turret audibly sharper than L1
- [ ] Turret tracers scale with level; troops flinch + HP flash under fire
- [ ] Dog: bark ❗ before the sprint, bite ≠ gunshot, flees with dust trail, never dies
- [ ] Building down → dust cloud → its own rubble pile; fence down → splinter, no gold ring
- [ ] Full clear → win stinger; army spent → subdued horn; loot correct on the done screen
- [ ] FIELD_CAP army + 2 turrets + dog: no audio mush, no FPS meltdown on a mid phone

### Share (B10)

- [ ] Share button → poster of MY base (buildings where I put them, banner shows name/HQ/🛡️/🏆)
- [ ] Native share sheet opens on phone (TWA); cancel does NOT error
- [ ] Desktop/no-share fallback: PNG downloads, caption lands on clipboard
- [ ] Image is < 2MB and readable when pasted into a chat

## Known residuals (updated 2026-08-17 — R1–R5 pass)

CLEARED by the residuals pass:
- ~~Fence/wall re-art + WALL re-measure~~ — R1: timber set (fence2/fence_post2/wall_se2 WebP), calibration carried silhouette-locked
- ~~SFX pack is basic DSP~~ — R2: foley-grade pack (modal synthesis + grain scatter + room reverb, 736KB, gen_r2_foley.mjs canonical)
- ~~No public visit-a-base route~~ — R3: /base/[id] read-only yard + rate-limited public API; share caption deep-links to it

Still accepted, not blockers:
- Ghost build preview is hover-only (desktop); mobile gets the gold pad pulse
- Snapshot draws damaged buildings charred but skips scorch decals/smoke — poster, not forensics
- Raid-THIS-base deep link from a visit page (visit CTAs funnel to the raid finder instead)
- SFX are synthesized foley, not recordings — individually swappable by filename if Michael ever licenses a pack
