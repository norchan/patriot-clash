import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })
// Public AdSense publisher id (visible in page source anyway) — hardcoded so
// verification works without extra env setup; env can override.

export const metadata: Metadata = {
  metadataBase: new URL('https://politicsgo.app'),
  title: 'PoliticsGo',
  description: 'Pick a party. Battle the other side in the streets, capture your town hall, and put your town on the battle map.',
  // Link-preview card (Twitter/X, iMessage, Discord…): the live national
  // battle map — without these tags a share is just a bare URL (Michael)
  openGraph: {
    title: 'PoliticsGo — the battle for America\'s town halls',
    description: 'Every dot is a real town hall held by Democrats or Republicans. Pick a side, walk your town, and take it.',
    url: '/',
    siteName: 'PoliticsGo',
    type: 'website',
    // ?v busts Twitter's card cache when the capture is re-shot (og_shot.mjs)
    images: [{ url: '/og.jpg?v=2', width: 2400, height: 1260, alt: 'The PoliticsGo national battle map' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PoliticsGo — the battle for America\'s town halls',
    description: 'Every dot is a real town hall held by Democrats or Republicans. Pick a side, walk your town, and take it.',
    images: ['/og.jpg?v=2'],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PoliticsGo',
    startupImage: '/icons/apple-touch-icon.png',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    // AdSense site-ownership verification
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>
          {children}
          {/* AdSense shelved (Michael 2026-08-10) — no ads served, script
              removed so the Play review sees a clean, ad-free app. Re-add the
              Script tag (git history) if ads ever return. */}
        </body>
      </html>
    </ClerkProvider>
  )
}