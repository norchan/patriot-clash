// Barracks (5 levels) + 10 troop sprites (Michael 2026-08-04: troop system —
// "5 levels... each generation bigger and better... five types of troops...
// lots of detail... political themes. Each side gets their own").
//
// Barracks levels are an EDIT CHAIN: L1 is generated, then each level edits
// the previous level's image — image input preserves the design identity while
// the prompt grows the compound (the technique that worked for the safes).
// Troops are 10 independent full-body character sprites.
//
//   node scripts/gen_troops_art.mjs             (all)
//   node scripts/gen_troops_art.mjs barracks    (just the building chain)
//   node scripts/gen_troops_art.mjs troops      (just the characters)
//
// Output: raw images in .legaudit/gen/, cutout via slice_hq_houses.mjs --single
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const BUILDING_STYLE = `Painterly isometric mobile-game building sprite in the style of a cozy Clash-of-Clans-like base builder: `
  + `three-quarter view from the front-left at roughly 30 degrees, warm soft studio lighting from the upper left, `
  + `hand-painted texture with clean dark outlines, slightly toy-like proportions, gentle grounded contact shadow. `
  + `SINGLE building group only, centered, entire object inside frame. `
  + `Plain flat light gray background (#cfcfcf), no checkerboard, no text, no watermark, no ground beyond a small dirt/grass base.`

const CHAR_STYLE = `Painterly mobile-game character sprite: ONE full-body character, standing in a confident pose, `
  + `three-quarter view, hand-painted texture with clean dark outlines, slightly toy-like heroic proportions, `
  + `warm soft light from the upper left, rich costume detail. Whole body including feet inside the frame, `
  + `plain flat light gray background (#cfcfcf), no text, no watermark, no logo.`

// ── the barracks chain ──────────────────────────────────────────────────────
const BARRACKS = [
  `A tiny campaign boot camp, level 1: a single olive-canvas pup tent with a small red pennant on a stick, `
    + `a hand-painted wooden "BOOT CAMP" style sign (no readable text), one strip of tire-run obstacle course, `
    + `a small wooden rack of training gear, packed dirt ground.`,
  `Expand this exact training camp into its LEVEL 2 version, keeping the same camera angle, palette and painterly style: `
    + `the pup tent grows into a timber cabin headquarters with a second tent beside it, a taller flagpole with a bigger pennant, `
    + `a sandbag ring and a low climbing wall added to the obstacle strip. Same small footprint, denser and better built.`,
  `Expand this exact training camp into its LEVEL 3 version, same camera, palette and painterly style: `
    + `the timber cabin becomes a curved-roof quonset-hut barracks with a bunkhouse wing, a wooden watch platform, `
    + `a longer obstacle course with hurdles, more pennant banners strung between poles.`,
  `Expand this exact training compound into its LEVEL 4 version, same camera, palette and painterly style: `
    + `brick-and-steel barracks buildings, a proper guard tower with a spotlight, an armory shed with sandbag walls, `
    + `a small parade ground with painted lines.`,
  `Expand this exact training compound into its LEVEL 5 version, same camera, palette and painterly style: `
    + `a grand fortress training citadel — stone-and-steel barracks with twin banner towers, floodlights, `
    + `a gilded eagle emblem over the gate, full obstacle yard, the most impressive version of this compound.`,
]

// ── the troops: 5 roles × 2 parties ────────────────────────────────────────
const TROOPS = {
  // REPUBLICANS (red accents)
  rep_minuteman: `A modern-day minuteman reenactor warrior: tricorn hat, colonial red-trimmed coat worn open over `
    + `blue jeans and work boots, antique musket with fixed bayonet held ready, powder horn on a strap, `
    + `determined grin. Red accent colors.`,
  rep_buck_hunter: `A backwoods hunter marksman: camouflage overalls, blaze-orange vest and beanie, `
    + `high-tech compound crossbow held across the chest, quiver of bolts, deer-antler pin on the vest, `
    + `steel thermos on the hip, calm squinting aim-face. Red accent colors.`,
  rep_big_rig: `A burly trucker tank-unit: huge shoulders, trucker cap, flannel shirt with rolled sleeves, `
    + `carrying a chrome semi-truck DOOR as a massive shield, tire-tread shoulder pad, big wrench in the other hand, `
    + `chin up, immovable stance. Red accent colors.`,
  rep_pyro_patriot: `A fireworks fanatic artillery-unit: safety goggles pushed up on the forehead, `
    + `stars-and-stripes bandana, bandolier of bottle rockets across the chest, a shoulder-mounted firework mortar tube, `
    + `holding a lit punk stick, gleeful grin, small sparks. Red accent colors.`,
  rep_revival_preacher: `A tent-revival preacher support-unit: crisp white suit with a red tie, big pompadour hair, `
    + `golden megaphone raised in one hand, collection bucket in the other, radiating a warm golden glow, `
    + `beaming showman smile. Red accent colors.`,
  // DEMOCRATS (blue accents)
  dem_picket_captain: `A union picket-line captain warrior: hard hat, hi-vis vest over a denim jacket, `
    + `wielding a big sturdy wooden picket sign on a thick post like a two-handed weapon (no readable text on the sign), `
    + `steel-toe boots, brass whistle on a lanyard, fired-up expression. Blue accent colors.`,
  dem_latte_slinger: `A battle barista ranged-unit: coffee-stained apron over a rolled-sleeve shirt, beanie, `
    + `tattoo sleeve, gripping two steaming espresso portafilters like sidearms, bandolier of syrup bottles, `
    + `one portafilter flinging an arc of scalding latte. Blue accent colors.`,
  dem_longshoreman: `A dockworker tank-unit: enormous shoulders, knit cap, hi-vis jacket open over a union tee, `
    + `carrying a riveted steel dock plate as a tower shield, cargo hook in the other hand, `
    + `feet planted wide, stone-faced. Blue accent colors.`,
  dem_drum_circle: `A drum-circle drummer artillery-unit: headband over wild curly hair, tie-dye shirt, hemp necklace, `
    + `giant rainbow-strapped djembe drum carried on a harness, both hands mid-slam with visible painted sonic `
    + `shockwave rings radiating out, ecstatic expression, sandals. Blue accent colors.`,
  dem_street_medic: `A protest street-medic support-unit: bike helmet with taped-on red cross, swim goggles, `
    + `rubber gloves, canvas first-aid satchel with rolled bandages, holding up a milk jug, `
    + `small painted green plus-symbols floating around, focused kind face. Blue accent colors.`,
}

fs.mkdirSync('.legaudit/gen', { recursive: true })

async function generate(name, prompt, size = '1024x1024') {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, quality: 'high' }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name} ${res.status}:`, JSON.stringify(j).slice(0, 250)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`)
  return true
}

async function edit(name, prompt, inputPath) {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync(inputPath)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name} ${res.status}:`, JSON.stringify(j).slice(0, 250)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`)
  return true
}

const what = process.argv[2] ?? 'all'

if (what === 'all' || what === 'barracks') {
  console.log('▶ barracks chain (each level edits the previous — identity carries)')
  const ok = await generate('barracks1', `${BUILDING_STYLE} ${BARRACKS[0]}`)
  if (ok) {
    for (let l = 2; l <= 5; l++) {
      const prev = `.legaudit/gen/barracks${l - 1}.png`
      if (!fs.existsSync(prev)) { console.error(`  missing ${prev}, stopping chain`); break }
      await edit(`barracks${l}`, `${BARRACKS[l - 1]} Keep it a painterly isometric mobile-game building sprite, `
        + `single building group centered, entirely inside frame, plain flat light gray background (#cfcfcf), no text.`, prev)
    }
  }
}

if (what === 'all' || what === 'troops') {
  console.log('▶ troops (10 characters)')
  for (const [id, prompt] of Object.entries(TROOPS)) {
    await generate(id, `${CHAR_STYLE} ${prompt}`)
  }
}
console.log('DONE')
