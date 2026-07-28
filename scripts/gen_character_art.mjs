// Character art generator (Michael 2026-07-27): makes roster caricatures in
// the house style — oversized head, full body, flat gray backdrop — sized and
// posed so scripts/meshy_pipeline.mjs can turn them into rigged 3D fighters.
//
//   node scripts/gen_character_art.mjs yard_sign_lady prepper
//   node scripts/gen_character_art.mjs            (all defined below)
//
// Output: public/enemies/<party>/<id>.png
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

// The house look, appended to every character prompt. Archetypes only — no
// real-person likenesses (Michael 2026-07-27, right-of-publicity call).
const STYLE = `Digital painting caricature in the style of a collectible bobblehead figure: `
  + `comically oversized head (about one third of total height) on a smaller normal-proportioned body. `
  + `FULL BODY visible head to feet, standing upright facing the viewer, arms hanging slightly away from the torso, `
  + `feet flat and slightly apart. Friendly exaggerated cartoon features, warm painterly shading, crisp clean edges. `
  + `Plain flat light gray studio background, soft contact shadow on the ground. `
  + `No text, no logos, no watermarks, no border. Single character, centered, entire figure inside the frame.`

const CHARACTERS = {
  yard_sign_lady: {
    party: 'democrat',
    prompt: `A cheerful suburban woman in her fifties, silver-blonde bob haircut, round tortoiseshell glasses, `
      + `wearing a quilted fleece vest over a striped shirt, khakis, and clogs, a canvas tote bag on one shoulder. `
      + `She grips a wooden-stake lawn yard sign in front of her like a shield — the sign is blank white with `
      + `colorful stripes, no readable words. Earnest determined smile.`,
  },
  prepper: {
    party: 'republican',
    prompt: `A stout bearded survivalist man in his forties, wearing a camouflage jacket, a tactical utility vest `
      + `covered in bulging pouches, cargo pants and worn combat boots, a battered green ball cap. `
      + `A bandolier of shiny tin cans across his chest instead of ammunition, and he cradles a dented metal `
      + `canned-goods tin in one hand like a grenade. Wary squinting expression, one eyebrow raised.`,
  },
  megachurch_pastor: {
    party: 'republican',
    prompt: `A beaming middle-aged televangelist in a shiny cream-white three-piece suit with a purple silk tie, `
      + `a chunky gold watch and several gold rings, blindingly white teeth and a perfectly sculpted silver pompadour. `
      + `He holds a small leather-bound book aloft in one hand and a gold collection plate in the other. `
      + `Theatrical, arms-wide showman energy.`,
  },
  crypto_bro: {
    party: 'republican',
    prompt: `A cocky young man in his late twenties with a shaved head and stubble, wearing a tight black t-shirt, `
      + `a gaudy oversized gold chain, wraparound sunglasses pushed up on his head, and designer sweatpants. `
      + `He dangles a sports-car key fob from one finger and clutches a glowing gold coin in the other hand. `
      + `Smug half-smirk, chin up.`,
  },
  sheriff: {
    party: 'republican',
    prompt: `A barrel-chested small-town sheriff in his fifties, tan uniform shirt with a shiny star badge, `
      + `mirrored aviator sunglasses, a thick bristly mustache, an enormous ornate belt buckle, and a wide-brimmed hat. `
      + `Thumbs hooked into his belt, standing with authority. Stern, unimpressed expression.`,
  },
  union_barista: {
    party: 'democrat',
    prompt: `A young barista with a messy dyed-teal undercut, round wire glasses, several ear piercings, `
      + `wearing a canvas apron over a flannel shirt with rolled sleeves, covered in enamel pins and buttons. `
      + `Forearm tattoos. Holds a steaming to-go coffee cup in one hand and a rolled-up stack of pamphlets in the other. `
      + `Tired but defiant expression.`,
  },
  adjunct_professor: {
    party: 'democrat',
    prompt: `A rumpled academic man in his forties with unruly curly hair and a scruffy beard, wire-rimmed glasses `
      + `slipping down his nose, wearing a brown corduroy blazer with leather elbow patches over a wrinkled shirt, `
      + `a loosened knit tie, and mismatched socks. An overstuffed canvas tote bag of papers hangs off one shoulder, `
      + `and he clutches a teetering stack of ungraded essays. Exhausted, distracted expression.`,
  },
  climate_kid: {
    party: 'democrat',
    prompt: `An earnest teenager with two braided pigtails, a knit beanie, freckles, wearing a puffy recycled-looking `
      + `jacket, patched jeans and hiking boots, with a reusable water bottle clipped to the backpack strap. `
      + `She holds up a blank cardboard protest placard on a wooden stick — no writing on it. `
      + `Fierce, determined expression, mouth open mid-shout.`,
  },
}

const want = process.argv.slice(2)
const todo = want.length ? want : Object.keys(CHARACTERS)

for (const id of todo) {
  const c = CHARACTERS[id]
  if (!c) { console.error(`unknown character: ${id}`); continue }
  const dir = `public/enemies/${c.party}`
  const dest = path.join(dir, `${id}.png`)
  fs.mkdirSync(new URL('../' + dir, import.meta.url), { recursive: true })
  console.log(`▶ ${id} (${c.party})...`)

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `${STYLE}\n\n${c.prompt}`,
      size: '1024x1536',
      quality: 'high',
      n: 1,
    }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${res.status}:`, JSON.stringify(j).slice(0, 400)); continue }
  const b64 = j.data?.[0]?.b64_json
  if (!b64) { console.error('  no image returned:', JSON.stringify(j).slice(0, 300)); continue }
  fs.writeFileSync(new URL('../' + dest, import.meta.url), Buffer.from(b64, 'base64'))
  console.log(`  ✔ ${dest} (${Math.round(fs.statSync(new URL('../' + dest, import.meta.url)).size / 1024)} KB)`)
}
console.log('\nDone. Review the art, then run meshy_pipeline.mjs per character for the 3D fighter.')
