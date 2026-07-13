import { NextRequest, NextResponse } from 'next/server'

// Deterministic flag avatar tied to a player's political affiliation.
//   ?party=republican -> red flag   ?party=democrat -> blue flag   else US flag
// Rendered as an SVG so it's free, crisp, and unlimited. Stars are drawn as
// polygons (no font dependency).

function starPoints(cx: number, cy: number, R: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r
    const a = (-90 + i * 36) * Math.PI / 180
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}

function usFlag(): string {
  const stripes: string[] = []
  const sh = 256 / 13
  for (let i = 0; i < 13; i++) {
    stripes.push(`<rect x="0" y="${(i * sh).toFixed(2)}" width="256" height="${sh.toFixed(2)}" fill="${i % 2 === 0 ? '#b22234' : '#ffffff'}"/>`)
  }
  const cantonW = 256 * 0.42, cantonH = sh * 7
  const stars: string[] = []
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const x = (cantonW / 6) * (c + 0.5)
      const y = (cantonH / 5) * (r + 0.5)
      stars.push(`<polygon points="${starPoints(x, y, 7, 3)}" fill="#fff"/>`)
    }
  }
  return `${stripes.join('')}<rect x="0" y="0" width="${cantonW}" height="${cantonH}" fill="#3c3b6e"/>${stars.join('')}`
}

function partyFlag(main: string, canton: string): string {
  // party-color field with white stripes + a starred canton
  const sh = 256 / 5
  const stripes: string[] = []
  for (let i = 0; i < 5; i++) {
    stripes.push(`<rect x="0" y="${(i * sh).toFixed(2)}" width="256" height="${sh.toFixed(2)}" fill="${i % 2 === 0 ? main : '#ffffff'}"/>`)
  }
  const cantonW = 256 * 0.5, cantonH = sh * 3
  const stars: string[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const x = (cantonW / 4) * (c + 0.5)
      const y = (cantonH / 3) * (r + 0.5)
      stars.push(`<polygon points="${starPoints(x, y, 9, 4)}" fill="#fff"/>`)
    }
  }
  return `${stripes.join('')}<rect x="0" y="0" width="${cantonW}" height="${cantonH}" fill="${canton}"/>${stars.join('')}`
}

export async function GET(req: NextRequest) {
  const party = req.nextUrl.searchParams.get('party')
  const body =
    party === 'republican' ? partyFlag('#c1121f', '#7f1d1d') :
    party === 'democrat' ? partyFlag('#1d4ed8', '#0f2a6b') :
    usFlag()

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}<rect width="256" height="256" fill="none"/></svg>`
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
