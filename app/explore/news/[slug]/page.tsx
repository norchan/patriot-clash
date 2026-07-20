import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { POSTS, getPost } from '../posts'

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return {}
  return {
    title: `${post.title} — PoliticsGo News`,
    description: post.excerpt,
    alternates: { canonical: `https://politicsgo.app/explore/news/${post.slug}` },
  }
}

export default async function NewsPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()
  const more = POSTS.filter(p => p.slug !== post.slug).slice(0, 3)
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/explore/news" className="hover:text-white">← All news</Link>
        </nav>
        <div className="text-gray-500 text-xs">{new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        <h1 className="text-3xl font-black text-white mt-1">{post.title}</h1>
        <div className="mt-6 space-y-4">
          {post.body.map((para, i) => (
            <p key={i} className="text-gray-300 leading-relaxed">{para}</p>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-purple-800 bg-purple-950/30 p-5 text-center">
          <p className="text-gray-300 text-sm">Play free at politicsgo.app — pick a side, walk your town.</p>
          <Link href="/" className="inline-block mt-3 px-6 py-2.5 rounded-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            Play PoliticsGo
          </Link>
        </div>
        <h2 className="text-lg font-bold text-white mt-10">More news</h2>
        <div className="mt-3 space-y-3">
          {more.map(p => (
            <Link key={p.slug} href={`/explore/news/${p.slug}`} className="block bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-purple-700 transition">
              <div className="font-bold text-white text-sm">{p.title}</div>
              <div className="text-gray-500 text-xs mt-0.5">{p.excerpt}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
