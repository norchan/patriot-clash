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

// ── FIGHTER STANCE (Michael 2026-07-29) ─────────────────────────────────────
// Use this INSTEAD of STYLE for anyone destined to become a playable fighter.
//
// Why it exists: the megachurch pastor was generated with STYLE above, whose
// "feet flat and slightly apart" produced art with the legs touching — and
// Meshy cannot carve a gap it cannot see, so it welded the trouser legs into
// one column standing on two shoes. Michael read that on his phone as "feet
// that connect and look like they have platforms under them". Same root cause
// smeared the hick's overalls and destroyed the Diva's floor-length gown the
// moment a kick animated.
//
// So the stance requirement is stated as the loudest thing in the prompt, and
// long/loose garments below the knee are banned outright for fighters. A gown
// to the floor can never survive a kick rig no matter how good the mesh is.
const FIGHTER_STANCE = `Digital painting caricature of a character for a fighting game roster. `
  + `FULL BODY, head to feet, facing the viewer, standing upright.\n`
  + `CRITICAL POSE REQUIREMENTS — these matter more than anything else:\n`
  + `• Feet planted WIDE APART, wider than the shoulders, in a confident fighting stance.\n`
  + `• A clear, obvious, unmistakable gap of plain background visible BETWEEN the two legs, `
  + `running all the way from the crotch down to the floor. The legs must NOT touch anywhere.\n`
  + `• Each leg, ankle and shoe fully separate and individually readable, with background between the shoes.\n`
  + `• Arms held out away from the body, clear of the torso, hands open and away from the hips.\n`
  + `• Legwear must END ABOVE THE ANKLE or be close-fitting: no floor-length gowns, robes, capes, `
  + `long coats, or baggy fabric hanging between the legs. Trousers tapered and clearly two separate legs.\n`
  + `Even, clean, evenly-coloured clothing — no heavy mud, stains, or blotchy dirt patches, `
  + `which turn into muddy smears once the model is textured.\n`
  + `Warm painterly shading, crisp clean edges, friendly exaggerated features. `
  + `Plain flat light gray studio background, soft contact shadow under each foot. `
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
  // ── NEW REPUBLICAN FIGHTERS (Michael 2026-07-30) ─────────────────────────
  // Four picks, deliberately differentiated: three of them could easily blur
  // into "angry man with a microphone", so each gets its own energy —
  // outdoors / unhinged / obsessive / slick.
  //
  // LIKENESS NOTE: Michael asked for an Alex Jones parody, and reaffirmed
  // after I flagged the risk (he's a broadcaster, not an officeholder, so the
  // political-caricature protection that covers The Don is weaker). Built as
  // an EXAGGERATED ARCHETYPE, not a portrait: no real name anywhere, no
  // photoreal likeness, no trademarked show branding. The frog is the joke.
  // Standing rule elsewhere is unchanged — archetypes only.
  militia_grandpa: {
    party: 'republican',
    fighter: true,
    prompt: `A cheerful weather-beaten grandfather in his seventies with a bristly white mustache and a deep farmer tan, `
      + `wearing an American-flag windbreaker over a polo shirt tucked into belted jeans, white sneakers, `
      + `and a mesh trucker cap. Binoculars hang round his neck and a battered plaid thermos is clipped to his belt. `
      + `He guards a driveway that needs no guarding. Content, vigilant, faintly smug expression.`,
  },
  frog_guy: {
    party: 'republican',
    fighter: true,
    prompt: `A furious red-faced broadcaster in his fifties, shaved-short hair, thick neck, glistening with sweat, `
      + `veins standing out on his forehead, mouth wide open mid-bellow. He wears a rumpled black polo shirt `
      + `stretched tight over a barrel chest, with a headset microphone pulled down to his chin. `
      + `He clutches a jar of glowing orange supplement powder in one fist, and a small bright green cartoon frog `
      + `sits calmly on his shoulder, unbothered. Wildly exaggerated cartoon rage, comic not menacing.`,
  },
  truther: {
    party: 'republican',
    fighter: true,
    prompt: `A wiry intense man in his forties with wispy thinning hair and wire-rim glasses pushed up his nose, `
      + `wearing a fishing vest over a tucked-in short-sleeve shirt, cargo shorts, black socks and sandals. `
      + `A red laser pointer in one hand and a fat roll of red yarn in the other, with printed pages spilling `
      + `from his vest pockets. Wide-eyed, urgent, mid-explanation — he has connected everything and needs you to see it.`,
  },
  broadcaster: {
    party: 'republican',
    fighter: true,
    prompt: `A smooth silver-haired AM radio host in his sixties with a golden tan and a blinding capped smile, `
      + `wearing an expensive navy blazer over an open-collar shirt with a flag lapel pin, and pressed slacks. `
      + `Big padded studio headphones round his neck, an unlit cigar between two fingers, `
      + `and a heavy chrome desk microphone gripped in the other hand. Confident, self-satisfied, mid-monologue.`,
  },

  // ── FIGHTER RE-GENERATIONS (Michael 2026-07-29) ──────────────────────────
  // These three are playable fighters whose legs broke in the arena. They use
  // FIGHTER_STANCE, not STYLE. Old art is kept as <id>_v1.png so a bad
  // regeneration is one file rename away from being undone.
  megachurch_pastor: {
    party: 'republican',
    fighter: true,
    prompt: `A beaming middle-aged televangelist in a shiny cream-white three-piece suit with a purple silk tie, `
      + `a chunky gold watch and several gold rings, blindingly white teeth and a perfectly sculpted silver pompadour. `
      + `His suit TROUSERS are tapered and clearly two separate legs with a wide gap between them, `
      + `ending at the ankle above polished brown dress shoes that are far apart. `
      + `Arms spread wide in theatrical showman energy, well clear of his body.`,
  },
  hick: {
    party: 'republican',
    fighter: true,
    prompt: `A big burly bearded farmer in his forties with wild grey-streaked hair and a thick beard, `
      + `wearing clean well-worn blue denim overalls over a red and white plaid shirt with rolled sleeves, `
      + `and sturdy tan work boots. The overall legs are TAPERED and tucked toward the boots — `
      + `two clearly separate legs planted wide apart with plain background visible between them. `
      + `Even, uniform denim colour with no mud, no stains and no dirt patches. `
      + `Arms out away from his sides, big hands open. Stubborn squinting expression.`,
  },
  drag: {
    party: 'democrat',
    fighter: true,
    // Redesigned per Michael: the floor-length gown was the actual bug. A hem
    // that reaches the ground gets dragged into a shapeless mass by any kick.
    prompt: `A fierce, glamorous drag performer with an enormous voluminous red bouffant wig and dramatic `
      + `sparkling stage makeup, wearing a SHORT sequinned emerald cocktail dress that ends WELL ABOVE THE KNEE, `
      + `with opaque black tights and tall shiny platform boots that stop below the knee. `
      + `Legs planted wide apart and fully visible from mid-thigh down, clear background between them. `
      + `One hand on a hip, the other arm flung out. Confident, theatrical, chin lifted.`,
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
  // Never overwrite art without keeping the original — a regeneration that
  // comes out worse should be undoable with a rename, not another API call.
  const destUrl = new URL('../' + dest, import.meta.url)
  const backup = new URL('../' + path.join(dir, `${id}_v1.png`), import.meta.url)
  if (fs.existsSync(destUrl) && !fs.existsSync(backup)) {
    fs.copyFileSync(destUrl, backup)
    console.log(`  kept original → ${id}_v1.png`)
  }
  console.log(`▶ ${id} (${c.party})${c.fighter ? ' [fighter stance]' : ''}...`)

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: `${c.fighter ? FIGHTER_STANCE : STYLE}\n\n${c.prompt}`,
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
