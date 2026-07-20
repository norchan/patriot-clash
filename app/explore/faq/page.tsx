import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'PoliticsGo FAQ — everything players ask',
  description:
    'Answers to the most common PoliticsGo questions: how FP works, how capturing works, town hall sieges, PvP, parties, privacy, and more.',
  alternates: { canonical: 'https://politicsgo.app/explore/faq' },
}

const FAQS: { q: string; a: string }[] = [
  { q: 'What is PoliticsGo?', a: 'A free location-based political satire game. Pick a party — Democrat or Republican — then walk your real neighborhood to earn points, battle satirical caricatures of the other side, capture them, and fight for control of real town halls. Think of it as a walking game where the map war never stops and both parties get roasted equally.' },
  { q: 'Is the game actually free?', a: 'Yes. Everything in the game can be earned by playing: walking earns Fighting Points, arcade games pay FP daily, and battles reward FP. You can optionally buy FP packs to speed things up, but nothing is locked behind payment.' },
  { q: 'What are Fighting Points (FP)?', a: 'The game’s energy and currency. You earn 100 FP per 150 steps walked with the app open (up to 30,000 steps a day), plus a 1,000 FP daily login bonus, plus arcade and battle rewards. FP pays for capture attempts, town hall siege attacks, PvP stakes, and shop items.' },
  { q: 'Do my steps count when the app is closed?', a: 'Not yet. The web app can only count steps while it’s open on screen — that’s a limitation phones place on all browser apps. The upcoming store versions will connect to Apple Health and Google’s step tracking so your full day counts.' },
  { q: 'How does capturing characters work?', a: 'Beat a character in battle and you get a capture roll. Common characters capture easily; rares escape more; legendaries need higher player levels and some luck. Every spawn is shared — the same characters appear in the same spots for everyone, and once five players catch a spawn it disappears for the whole area.' },
  { q: 'Why can’t I beat The Don?', a: 'The Don is gated: below player level 5 he is effectively unbeatable by design. Level up on commons and rares first. Each party’s legendaries are meant to be trophies, not warm-ups.' },
  { q: 'How do town hall sieges work?', a: 'Town halls hold defense points. Attacks (within 10 miles) grind defense down; boosts like firecrackers and rockets speed it up; the final assault must be a real attack, not an item. Flip the hall and your party holds it — then it’s your job to defend it with FP donations and your clique.' },
  { q: 'What’s the Arena?', a: 'The colosseum on the map next to your local town hall. Inside: player-vs-player matchmaking by level bracket, live one-on-one fights, national daily and all-time rankings, and the fighter designer where you build your combatant and pick a bobblehead.' },
  { q: 'Can I be friends with someone from the other party?', a: 'Yes — friendships are fully cross-party. Your friends list is completely private: nobody can see who your friends are or how many you have, and declined requests are never announced.' },
  { q: 'Can I switch parties?', a: 'Once every 30 days, from Settings. Switching leaves your clique behind and your enemies change sides — the characters you hunt are always the opposite party.' },
  { q: 'Is my location shared with other players?', a: 'Only if you allow it, and with controls: you can appear at an approximate location instead of your exact one, hide from the map entirely, or hide your party affiliation. Location powers gameplay (spawns, halls in range) and is never sold.' },
  { q: 'Are the characters real politicians?', a: 'No. Every character is an original satirical caricature — exaggerated archetypes in the tradition of political cartoons. Both parties get the same treatment. Any resemblance is the joke, not the claim.' },
  { q: 'What phones does it work on?', a: 'Any modern phone browser. On iPhone: open politicsgo.app in Safari, Share → Add to Home Screen, and it runs fullscreen like an app (with push notifications on iOS 16.4+). An Android app is on the way to Google Play.' },
  { q: 'What’s the age requirement?', a: 'PoliticsGo is for players 17 and up. It’s political satire with cartoon combat — nothing gory, but it’s not built for kids.' },
  { q: 'How do the arcade games pay?', a: 'Free arcade games (Pic Hunt, Checkmate Chamber, Landslide, Tet-Kris) pay FP for wins, capped at a shared 5,000 FP per day. The slot machines take FP bets and pay from them — the house edge is real, budget accordingly.' },
  { q: 'Who makes PoliticsGo?', a: 'PoliticsGo L.L.C., a small independent studio in Saint Peter, Minnesota. Questions, feedback, press: info@politicsgo.net.' },
]

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">Frequently Asked Questions</h1>
        <div className="mt-8 space-y-6">
          {FAQS.map(f => (
            <div key={f.q}>
              <h2 className="text-lg font-bold text-white">{f.q}</h2>
              <p className="mt-1.5 text-gray-400 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Still curious? The best answer is a walk around the block.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo free
          </Link>
        </div>
        <footer className="mt-10 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore/guide" className="hover:text-gray-400">How to Play</Link>
          <Link href="/explore/characters" className="hover:text-gray-400">Characters</Link>
          <Link href="/explore/scoreboard" className="hover:text-gray-400">Scoreboard</Link>
          <Link href="/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-400">Terms</Link>
        </footer>
      </div>
    </div>
  )
}
