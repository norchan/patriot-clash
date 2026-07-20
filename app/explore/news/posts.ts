// Public dev-news posts — real update notes written for players. Each entry
// renders at /explore/news/<slug>. Newest first.

export interface NewsPost {
  slug: string
  date: string // ISO
  title: string
  excerpt: string
  body: string[] // paragraphs
}

export const POSTS: NewsPost[] = [
  {
    slug: 'the-governor-joins-the-roster',
    date: '2026-07-20',
    title: 'New character: The Governor joins the Democrat roster',
    excerpt: 'A brand-new rare character who never stops moving — literally.',
    body: [
      'The roster grows again. The Governor is a new rare-tier Democrat character, and he plays unlike anyone else in the game: he is the only character who paces. Instead of standing his ground and sidestepping, he sweeps the full width of the battle stage, back and forth, flipping direction at each end — and pelting you with his signature tampon toss the whole time.',
      'Timing your throws against a moving target is a genuinely different fight. Lead him a little; his turns are the moment to strike.',
      'The Governor spawns anywhere Democrat characters do, shares the rare-tier capture odds, and pays 40 FP per win. Good luck hitting a moving target.',
    ],
  },
  {
    slug: 'shared-world-spawns',
    date: '2026-07-19',
    title: 'The world is now shared: same characters, same spots, for everyone',
    excerpt: 'Spawns went server-side — and legendaries became genuinely scarce.',
    body: [
      'Until now, every phone generated its own enemy spawns. As of this update the world is shared: every player sees the same characters in the same places. Each town hall circle stocks two of every character — except each party’s two legendaries, which get exactly one spawn spot per hall.',
      'Spawns live 15 minutes and every hall re-rolls its lineup every 10, so the map stays fresh. And here is the competitive part: once five different players catch a spawn, it disappears for everyone. When a legendary pops near your town hall, you are racing your neighbors.',
      'A few spawns also land near recently-active players, so checking the map on a walk is always worth it.',
    ],
  },
  {
    slug: 'the-arena-opens',
    date: '2026-07-19',
    title: 'The Arena is open: find fights, climb the national rankings',
    excerpt: 'A colosseum landed next to your local town hall.',
    body: [
      'Look east of your local town hall on the map: there is a colosseum there now. The Arena is PoliticsGo’s player-vs-player hub — browse opponents by level bracket (Rookie 1-4 through Elite 20+), challenge anyone with one tap, and design your fighter without leaving the building.',
      'Every completed PvP fight now counts toward two national leaderboards: Today’s Champions, which resets at midnight, and the All-Time Greats. Win anywhere in the country and climb both.',
      'Challenges stake 50 FP, winner takes the pot. The first fight settled each day crowns that day’s first champion — an easy title to steal if you fight at breakfast.',
    ],
  },
  {
    slug: 'pic-hunt-and-the-arcade',
    date: '2026-07-18',
    title: 'Arcade update: Pic Hunt, chess puzzles, and a 3D facelift',
    excerpt: 'Two brand-new games and a visual overhaul for the classics.',
    body: [
      'The Arcade next to your town hall doubled in size. Pic Hunt is a classic spot-the-differences — two photographs, six changes, two minutes, with pre-made puzzle variations so no two rounds play the same. Checkmate Chamber brings 148 machine-verified chess puzzles, mate-in-one through mate-in-three, on a classic wooden board — and any move that forces the mate counts, not just one scripted answer.',
      'The classics got love too: the slot machines now render as proper 3D cabinets with curved spinning reels, and Tet-Kris blocks became beveled 3D pieces. Landslide picked up a per-level clock and a fix for its infamous Ring level.',
      'Free arcade games pay out up to 5,000 FP a day. The slots, as always, pay from your bets — the house respects a budget.',
    ],
  },
  {
    slug: 'politicsgo-is-live',
    date: '2026-07-09',
    title: 'PoliticsGo is live at politicsgo.app',
    excerpt: 'Pick a party. Walk your town. Capture the town hall.',
    body: [
      'PoliticsGo is live. Pick your party — Democrat or Republican — and your real neighborhood becomes the map: satirical characters from the other side spawn around real town halls, and walking to them is the game. Battle them, capture them, and build your collection.',
      'Town halls across America are capturable territory with their own local feeds. Take one for your party, defend it with your clique, and argue about it in the town square afterward — that part is tradition.',
      'Walking earns Fighting Points (100 FP per 150 steps), which power captures, sieges, and shop items. The game is free to play, runs in your phone browser, and installs to your home screen on both iPhone and Android.',
    ],
  },
]

export const getPost = (slug: string) => POSTS.find(p => p.slug === slug)
