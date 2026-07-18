import Link from 'next/link'
import type { Metadata } from 'next'

// Public Terms of Service — required for AdSense review, the app-store
// listings, and Stripe. TEMPLATE: have a lawyer review before relying on it
// in a dispute.
export const metadata: Metadata = {
  title: 'Terms of Service — PoliticsGo',
  description: 'The rules for playing PoliticsGo.',
  alternates: { canonical: 'https://politicsgo.app/terms' },
}

const UPDATED = 'July 18, 2026'
const CONTACT = 'info@politicsgo.net'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-black text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-gray-300 leading-relaxed text-[15px]">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/explore" className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <span className="font-black tracking-tight text-lg">PoliticsGo</span>
          </Link>
          <Link href="/sign-up" className="font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5 text-sm">Play free</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10">
        <h1 className="text-3xl font-black text-white">Terms of Service</h1>
        <p className="text-gray-500 mt-2">Last updated: {UPDATED}</p>

        <Section title="1. Who we are, and your agreement">
          <p>
            PoliticsGo is operated by <strong className="text-white">PoliticsGo L.L.C.</strong>, Saint
            Peter, Minnesota, USA (&quot;we&quot;, &quot;us&quot;). By creating an account or playing
            PoliticsGo (the &quot;Game&quot;), you agree to these Terms and to our{' '}
            <Link href="/privacy" className="text-blue-400 underline">Privacy Policy</Link>. If you do
            not agree, do not play.
          </p>
        </Section>

        <Section title="2. Eligibility">
          <p>
            You must be at least <strong className="text-white">17 years old</strong> to play. The Game
            contains political satire, competitive fighting themes, and user-generated content, and is
            not directed at children. You are responsible for keeping your account credentials secure.
          </p>
        </Section>

        <Section title="3. The Game is satire">
          <p>
            PoliticsGo is an entertainment product. Its characters, factions, town halls, battles, and
            in-game commentary are <strong className="text-white">fictional political satire</strong>.
            Nothing in the Game is a statement of fact about any real person or organization, an
            endorsement of any candidate or party, or a call to real-world action.
          </p>
        </Section>

        <Section title="4. Play safely and legally">
          <p>
            The Game uses your real-world location. You are solely responsible for your surroundings:
            do not trespass, do not play while driving, do not enter unsafe areas, and obey all laws.
            Locations shown in the Game (including &quot;town halls&quot;) are game markers — they do
            not grant you any right to enter or remain anywhere in the real world.
          </p>
        </Section>

        <Section title="5. Fighting Points (FP) and purchases">
          <ul className="list-disc pl-6 space-y-1.5">
            <li>FP is a <strong className="text-white">virtual currency with no real-world value</strong>. It cannot be redeemed for cash, transferred outside the Game, or sold.</li>
            <li>FP purchases are processed by Stripe. All purchases are <strong className="text-white">final and non-refundable</strong> except where required by law.</li>
            <li>We may change FP earn rates, prices, and game balance at any time.</li>
            <li>If your account is terminated for violating these Terms, unused FP is forfeited.</li>
          </ul>
        </Section>

        <Section title="6. Your content">
          <p>
            You keep ownership of content you post (posts, comments, photos, messages, profile
            content), and you grant us a worldwide, royalty-free license to host, display, and
            distribute it within the Game. You promise your content does not violate anyone&apos;s
            rights or these Terms.
          </p>
        </Section>

        <Section title="7. Conduct — the ban list">
          <p>You may not:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>harass, threaten, or dox other players, or post hate content targeting protected groups;</li>
            <li>post sexual content involving minors (zero tolerance — reported to authorities), or any illegal content;</li>
            <li>impersonate real people, or use the Game to deceive;</li>
            <li>cheat: GPS spoofing, automation/bots, exploiting bugs, or manipulating FP;</li>
            <li>scrape, reverse engineer, or attack the service;</li>
            <li>use the Game to plan or incite real-world harm.</li>
          </ul>
          <p>
            We may remove content, suspend, or permanently ban any account at our discretion,
            including for conduct not listed above. Use the in-game report and block tools —
            reports are reviewed.
          </p>
        </Section>

        <Section title="8. Ads">
          <p>
            The Game is supported by advertising (including Google AdSense). Ads are provided by
            third parties; we do not endorse advertised products. See the{' '}
            <Link href="/privacy" className="text-blue-400 underline">Privacy Policy</Link> for how ad
            personalization and cookies work and how to opt out.
          </p>
        </Section>

        <Section title="9. Availability, changes, termination">
          <p>
            The Game is provided &quot;as is&quot; and &quot;as available.&quot; We may modify,
            suspend, or discontinue any part of the Game at any time, including wiping seasonal or
            world state (town hall control, leaderboards). You may delete your account at any time
            from Settings or by emailing us.
          </p>
        </Section>

        <Section title="10. Disclaimers and limits on liability">
          <p>
            To the maximum extent permitted by law: we disclaim all warranties, express or implied;
            we are not liable for indirect, incidental, special, consequential, or punitive damages,
            or for anything that happens to you in the physical world while playing; and our total
            liability for any claim is limited to the greater of $50 or the amount you paid us in the
            12 months before the claim.
          </p>
        </Section>

        <Section title="11. Governing law and disputes">
          <p>
            These Terms are governed by the laws of the State of Minnesota, USA. Disputes will be
            resolved in the state or federal courts located in Minnesota, and you consent to their
            jurisdiction.
          </p>
        </Section>

        <Section title="12. Changes to these Terms">
          <p>
            We may update these Terms; the &quot;Last updated&quot; date will change and material
            changes will be announced in-game. Continuing to play after changes means you accept them.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions? Email <a href={`mailto:${CONTACT}`} className="text-blue-400 underline">{CONTACT}</a>.
          </p>
        </Section>
      </main>

      <footer className="border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-5 py-6 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} PoliticsGo L.L.C.</span>
          <div className="flex gap-5">
            <Link href="/explore" className="hover:text-gray-300">Explore</Link>
            <Link href="/privacy" className="hover:text-gray-300">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-300">Terms</Link>
            <Link href="/sign-up" className="hover:text-gray-300">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
