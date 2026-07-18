import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/welcome',
  '/explore(.*)', // public, crawlable content pages (AdSense review + SEO)
  '/privacy', // public privacy policy (Play listing + AdSense)
  '/terms', // public terms of service (AdSense + app stores + Stripe)
  '/.well-known(.*)', // Android TWA domain verification (assetlinks.json)
  '/ads.txt', // AdSense ads.txt (must return 200, not a redirect)
  '/robots.txt',
  '/sitemap.xml',
  '/api/public(.*)', // guest preview world data (anonymized)
  '/api/avatar(.*)', // generated meme-card avatar images (no auth needed)
  '/api/webhooks/clerk',
  '/api/webhooks/stripe',
  '/api/cron(.*)', // Vercel cron jobs — protected by CRON_SECRET bearer instead
])

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return

  // Signed-out visitors browsing the site land on the guest preview map
  // instead of a sign-in wall; API calls still get a hard 401.
  const { userId } = await auth()
  if (!userId) {
    const { pathname } = request.nextUrl
    if (request.method === 'GET' && !pathname.startsWith('/api')) {
      // Serve the welcome page AT the root as a 200 (rewrite, not redirect) so
      // crawlers — e.g. the AdSense verifier — see the page and its
      // verification tag directly instead of a 307. Other paths still redirect.
      if (pathname === '/') {
        return NextResponse.rewrite(new URL('/welcome', request.url))
      }
      return NextResponse.redirect(new URL('/welcome', request.url))
    }
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
