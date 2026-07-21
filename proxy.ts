import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/', // homepage = the public battle map (signed-in users get their profile sidebar)
  '/battlemap', // full-screen public battle map
  '/boards', // the boards deck full-page (menu + psub tabs + feed)
  '/play(.*)', // guest game world (Cahokia) + guest sprite battles + guest arcade lobby
  '/arcade', // arcade lobby is browsable by guests
  '/arcade/spotit', '/arcade/landslide', '/arcade/tetkris', '/arcade/chess', // free-to-play games (FP APIs still 401); slots bets FP → stays signed-in only
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/welcome',
  '/explore(.*)', // public, crawlable content pages (AdSense review + SEO)
  '/p(.*)', // public post boards (p/all, p/minnesota, ...) — read-only windows over hall feeds
  '/privacy', // public privacy policy (Play listing + AdSense)
  '/terms', // public terms of service (AdSense + app stores + Stripe)
  '/manifest.json', // PWA manifest — must be public for install prompts + the Android TWA build
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

  // Signed-out visitors hitting a game page get sent to the public homepage
  // (the battle map) instead of a sign-in wall; API calls still get a hard 401.
  const { userId } = await auth()
  if (!userId) {
    const { pathname } = request.nextUrl
    if (request.method === 'GET' && !pathname.startsWith('/api')) {
      return NextResponse.redirect(new URL('/', request.url))
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
