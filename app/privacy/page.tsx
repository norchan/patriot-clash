import Link from 'next/link'
import type { Metadata } from 'next'

// Public privacy policy — required for the Google Play listing + Data Safety
// form, and for AdSense. TEMPLATE: review the contact email and, ideally, have
// a lawyer glance at it before relying on it.
export const metadata: Metadata = {
  title: 'Privacy Policy — PoliticsGo',
  description: 'How PoliticsGo collects, uses, and protects your information.',
  alternates: { canonical: 'https://politicsgo.app/privacy' },
}

const UPDATED = 'July 12, 2026'
const CONTACT = 'support@politicsgo.app'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-black text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-gray-300 leading-relaxed text-[15px]">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-black text-white">Privacy Policy</h1>
        <p className="text-gray-500 mt-2">Last updated: {UPDATED}</p>

        <p className="mt-6 text-gray-300 leading-relaxed text-[15px]">
          PoliticsGo (&ldquo;we,&rdquo; &ldquo;us&rdquo;) is a location-based game available at
          politicsgo.app and as a mobile app. This policy explains what information we collect,
          how we use it, and the choices you have. By using PoliticsGo you agree to this policy.
        </p>

        <Section title="Who can use PoliticsGo">
          <p>
            PoliticsGo is intended for users <strong className="text-white">13 years of age and older</strong>.
            It contains simulated casino-style games that use in-game points only (no real-money gambling
            and no cash payouts). It is not directed to children under 13, and we do not knowingly collect
            information from them.
          </p>
        </Section>

        <Section title="Information we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-white">Account information</strong> — your email address and sign-in details, handled by our authentication provider (Clerk).</li>
            <li><strong className="text-white">Profile information</strong> — your chosen username, party affiliation, avatar, and any photos or posts you add.</li>
            <li><strong className="text-white">Location</strong> — your device&rsquo;s approximate or precise location, used to place you on the map and show nearby town halls and players. You control your visibility and can enable approximate-location mode in Settings.</li>
            <li><strong className="text-white">Activity &amp; steps</strong> — gameplay activity (battles, captures, posts, messages) and step counts used to award in-game Fighting Points.</li>
            <li><strong className="text-white">Purchases</strong> — if you buy Fighting Points, payments are processed by Stripe. We do not store your full card details.</li>
            <li><strong className="text-white">Device &amp; usage data</strong> — standard technical data such as device type, browser, and interactions, used to operate and improve the game.</li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>To run the game — place you on the map, match battles, deliver messages, and award points.</li>
            <li>To keep the community safe — screen uploaded images and text for prohibited content.</li>
            <li>To process purchases and prevent fraud.</li>
            <li>To show advertising that helps keep the game free.</li>
            <li>To maintain, secure, and improve the service.</li>
          </ul>
        </Section>

        <Section title="Advertising &amp; cookies">
          <p>
            We use <strong className="text-white">Google AdSense</strong> to display ads. Google and its
            partners may use cookies and device identifiers to serve and personalize ads based on your
            visits to this and other sites. You can control ad personalization at{' '}
            <a href="https://myadcenter.google.com" className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">myadcenter.google.com</a>{' '}
            and learn more at{' '}
            <a href="https://policies.google.com/technologies/ads" className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">Google&rsquo;s Ads policy</a>.
          </p>
        </Section>

        <Section title="Who we share information with">
          <p>We do not sell your personal information. We share data only with service providers that help us run the game:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-white">Clerk</strong> — account authentication.</li>
            <li><strong className="text-white">Supabase</strong> — database and file storage.</li>
            <li><strong className="text-white">Stripe</strong> — payment processing.</li>
            <li><strong className="text-white">Mapbox</strong> — maps.</li>
            <li><strong className="text-white">Google AdSense</strong> — advertising.</li>
            <li><strong className="text-white">OpenAI</strong> — automated content moderation and game features.</li>
          </ul>
          <p>We may also disclose information if required by law or to protect the safety of our users.</p>
        </Section>

        <Section title="Your choices &amp; rights">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-white">Location</strong> — you can hide yourself from the map or use approximate location in Settings, or turn off location permission on your device.</li>
            <li><strong className="text-white">Access &amp; correction</strong> — you can view and edit your profile in the app.</li>
            <li><strong className="text-white">Account &amp; data deletion</strong> — you can request deletion of your account and associated data by emailing us at{' '}
              <a href={`mailto:${CONTACT}`} className="text-blue-400 underline">{CONTACT}</a>. We will delete your data within 30 days, except where we must retain it for legal or fraud-prevention reasons.</li>
          </ul>
        </Section>

        <Section title="Data retention &amp; security">
          <p>
            We keep your information for as long as your account is active or as needed to provide the game,
            comply with our legal obligations, and resolve disputes. We use industry-standard measures to
            protect your data, though no method of transmission or storage is completely secure.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. We will revise the &ldquo;Last updated&rdquo; date above
            and, for significant changes, provide additional notice.
          </p>
        </Section>

        <Section title="Contact us">
          <p>
            Questions or requests? Email <a href={`mailto:${CONTACT}`} className="text-blue-400 underline">{CONTACT}</a>.
          </p>
        </Section>
      </main>

      <footer className="border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-5 py-6 text-sm text-gray-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>© {new Date().getFullYear()} PoliticsGo</span>
          <div className="flex gap-5">
            <Link href="/explore" className="hover:text-gray-300">Explore</Link>
            <Link href="/privacy" className="hover:text-gray-300">Privacy</Link>
            <Link href="/sign-up" className="hover:text-gray-300">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
