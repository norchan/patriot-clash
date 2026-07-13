// 3D model manifest — one GLB per character, generated from the sprite art.
// Model filename matches the sprite's basename in public/enemies.
export interface Model3D { id: string; name: string; party: 'republican' | 'democrat'; model: string; ready?: boolean }

export const MODELS_3D: Model3D[] = [
  // Republicans
  { id: 'oil_baron',    name: 'Oil Baron',         party: 'republican', model: '/models/oil_baron.glb' },
  { id: 'cowboy',       name: 'Lone Star',         party: 'republican', model: '/models/cowboy.glb' },
  { id: 'politician',   name: 'The Don',           party: 'republican', model: '/models/politician.glb' },
  { id: 'eagle',        name: 'Freedom Eagle',     party: 'republican', model: '/models/eagle.glb' },
  { id: 'hick',         name: 'Good Ole Boy',      party: 'republican', model: '/models/hick.glb' },
  { id: 'ice_agent',    name: 'The Ice Man',       party: 'republican', model: '/models/ice_agent.glb' },
  { id: 'soldier_boy',  name: 'Sgt. Stars',        party: 'republican', model: '/models/soldier_boy.glb' },
  { id: 'preppy',       name: 'Country Club Chad', party: 'republican', model: '/models/preppy.glb' },
  { id: 'influencer',   name: 'Campus Crusader',   party: 'republican', model: '/models/influencer.glb' },
  { id: 'billionaire',  name: 'Rocket Man',        party: 'republican', model: '/models/billionaire.glb', ready: false },
  // Democrats
  { id: 'crazy_liberal',  name: 'Policy Wonk',     party: 'democrat', model: '/models/crazy_liberal.glb' },
  { id: 'crying_liberal', name: 'Tear Drop',       party: 'democrat', model: '/models/crying_liberal.glb' },
  { id: 'dem_politician', name: 'Shadow Senator',  party: 'democrat', model: '/models/politician_dems.glb' },
  { id: 'purple_hair',    name: 'Purple Fury',     party: 'democrat', model: '/models/purple_hair.glb' },
  { id: 'protestor',      name: 'Riot Gear',       party: 'democrat', model: '/models/protestor.glb' },
  { id: 'anchor',         name: 'Prime Time',      party: 'democrat', model: '/models/anchor.glb' },
  { id: 'palestine',      name: 'The Activist',    party: 'democrat', model: '/models/palestine.glb' },
  { id: 'comrade',        name: 'The Comrade',     party: 'democrat', model: '/models/comrade.glb' },
  { id: 'drag',           name: 'The Diva',        party: 'democrat', model: '/models/drag.glb', ready: false },
  { id: 'senator',        name: 'The Chairman',    party: 'democrat', model: '/models/senator.glb' },
]

export const modelById = (id: string) => MODELS_3D.find(m => m.id === id)
