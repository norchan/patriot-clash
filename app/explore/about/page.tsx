import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About PoliticsGo — who we are and why we made this',
  description:
    'PoliticsGo is an independent political-satire walking game from PoliticsGo L.L.C. in Saint Peter, Minnesota. Our story, our satire policy, and how to reach us.',
  alternates: { canonical: 'https://politicsgo.app/explore/about' },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">About PoliticsGo</h1>
        <div className="mt-6 space-y-4 text-gray-300 leading-relaxed">
          <p>
            PoliticsGo started with a simple observation: Americans will not agree about
            politics, but almost everyone agrees that politics has become a spectator sport.
            So we made it an actual sport — one you play on foot, in your own town, against
            your actual neighbors.
          </p>
          <p>
            PoliticsGo is an independent game built by <strong>PoliticsGo L.L.C.</strong>, a
            small studio in Saint Peter, Minnesota — a real town whose real town hall is,
            as of this writing, being fought over inside the game by people who drive past
            it every day. That is the whole idea working as intended.
          </p>
          <p>
            The game is satire, and we are strict about the rules of satire: <strong>both
            parties get it, equally.</strong> Our characters are original caricatures in the
            tradition of the American political cartoon — exaggerated archetypes, not real
            people. If you finish a play session feeling like the game was unfair to your
            side, we recommend capturing three of the other side&apos;s characters; players
            report this helps enormously.
          </p>
          <p>
            We take a few things genuinely seriously: player privacy (your friends list and
            location visibility are yours to control), fair play (the economy is
            server-enforced and anti-farm capped), and keeping the fight in the game. The
            town squares get rowdy — that&apos;s the fun — but harassment, threats, and hate
            have no place here, and reporting tools are one tap away on every post.
          </p>
          <p>
            PoliticsGo runs on the web at politicsgo.app, installs to your home screen on
            iPhone and Android, and is on its way to the app stores.
          </p>
        </div>

        <h2 className="text-xl font-bold text-white mt-10">Contact</h2>
        <p className="mt-2 text-gray-400">
          Questions, feedback, press, or partnership inquiries:{' '}
          <a href="mailto:info@politicsgo.net" className="text-purple-400 hover:text-purple-300">info@politicsgo.net</a>
          <br />PoliticsGo L.L.C. · Saint Peter, Minnesota, USA
        </p>

        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">The map war is already on. Your town needs you.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo free
          </Link>
        </div>
        <footer className="mt-10 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore/guide" className="hover:text-gray-400">How to Play</Link>
          <Link href="/explore/faq" className="hover:text-gray-400">FAQ</Link>
          <Link href="/explore/scoreboard" className="hover:text-gray-400">Scoreboard</Link>
          <Link href="/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-400">Terms</Link>
        </footer>
      </div>
    </div>
  )
}
