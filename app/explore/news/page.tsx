import Link from 'next/link'
import type { Metadata } from 'next'
import { POSTS } from './posts'

export const metadata: Metadata = {
  title: 'PoliticsGo News & Updates',
  description: 'Official development news and update notes for PoliticsGo — new characters, features, and events.',
  alternates: { canonical: 'https://politicsgo.app/explore/news' },
}

export default function NewsIndex() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore" className="hover:text-white">← Explore</Link>
        </nav>
        <h1 className="text-3xl font-black text-white">News & Updates</h1>
        <p className="mt-2 text-gray-400">What&apos;s new in PoliticsGo, straight from the developers.</p>
        <div className="mt-8 space-y-5">
          {POSTS.map(p => (
            <Link key={p.slug} href={`/explore/news/${p.slug}`}
              className="block bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-purple-700 transition">
              <div className="text-gray-500 text-xs">{new Date(p.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <h2 className="text-lg font-bold text-white mt-1">{p.title}</h2>
              <p className="text-gray-400 text-sm mt-1">{p.excerpt}</p>
            </Link>
          ))}
        </div>
        <footer className="mt-12 text-center text-gray-600 text-xs space-x-3">
          <Link href="/explore/guide" className="hover:text-gray-400">How to Play</Link>
          <Link href="/explore/characters" className="hover:text-gray-400">Characters</Link>
          <Link href="/privacy" className="hover:text-gray-400">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-400">Terms</Link>
        </footer>
      </div>
    </div>
  )
}
