import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })
// Public AdSense publisher id (visible in page source anyway) — hardcoded so
// verification works without extra env setup; env can override.
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || 'ca-pub-5293418453940819'

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
    images: [{ url: '/og.jpg', width: 2400, height: 1260, alt: 'The PoliticsGo national battle map' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PoliticsGo — the battle for America\'s town halls',
    description: 'Every dot is a real town hall held by Democrats or Republicans. Pick a side, walk your town, and take it.',
    images: ['/og.jpg'],
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
    'google-adsense-account': ADSENSE_CLIENT,
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
          {ADSENSE_CLIENT && (
            <Script
              id="adsbygoogle-init"
              strategy="beforeInteractive"
              crossOrigin="anonymous"
              src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            />
          )}
        </body>
      </html>
    </ClerkProvider>
  )
}