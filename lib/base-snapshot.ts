// Base snapshot (B10): render the player's yard to a shareable PNG.
//
// The live yard is DOM + CSS transforms, so instead of screenshotting it we
// REDRAW it on a canvas from the same data and the same geometry the stage
// uses — isoPos anchors, sprite widths, fence-link math, wall_se offsets all
// come from the single sources of truth (lib/base-stage, components/IsoYard,
// config/house). Same-origin images only, so toBlob never hits a tainted
// canvas. Output is a 1391×910 PNG poster: full lot, party-tinted banner.

import { GRID, HQ_PAD, hqImage, safeImage, barracksImage, solarImage, turretImage } from '@/config/house'
import { isoPos, TILE_H, STAGE_W, STAGE_H } from '@/lib/base-stage'
import { fenceAdjacency, WALL } from '@/components/IsoYard'

const SCALE = 0.65 // 2140×1400 logical → 1391×910 out — crisp but light

// sprite art per type — the same table the hq page renders from
const ART: Record<string, { img: (level: number) => string; w: number }> = {
  fence: { img: () => '/house/fence2.webp', w: 76 },
  media_tower: { img: () => '/house/media_tower.webp', w: 126 },
  safe: { img: l => safeImage(l), w: 96 },
  barracks: { img: l => barracksImage(l), w: 150 },
  solar: { img: l => solarImage(l), w: 134 },
  doberman: { img: () => '/house/doberman.webp', w: 104 },
  turret: { img: l => turretImage(l), w: 118 },
}
const LINK_H = 64 // straight fence-bridge panel height (IsoYard LINK_H)

export interface SnapshotInput {
  buildings: Array<{ pad: number; type: string; level: number; facing?: number; damaged?: boolean }>
  hqLevel: number
  printShopPad: number
  name: string
  tint: string      // party accent for the banner
  defScore: number
  trophies: number
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null) // a missing sprite skips, never breaks the card
    im.src = src
  })
}

export async function snapshotBase(inp: SnapshotInput): Promise<Blob> {
  // ── collect every src once ──
  const srcs = new Set<string>(['/house/yard_bg2.webp', hqImage(inp.hqLevel), '/house/print_shop.webp',
    '/house/fence_post2.webp', '/house/fence2.webp', '/house/wall_se2.webp'])
  for (const b of inp.buildings) {
    const a = ART[b.type]
    if (a) srcs.add(a.img(b.level))
  }
  const loaded = new Map<string, HTMLImageElement | null>()
  await Promise.all([...srcs].map(async s => loaded.set(s, await loadImg(s))))

  const cv = document.createElement('canvas')
  cv.width = Math.round(STAGE_W * SCALE)
  cv.height = Math.round(STAGE_H * SCALE)
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.scale(SCALE, SCALE)
  ctx.imageSmoothingQuality = 'high'

  // ── ground: object-cover, exactly like the stage ──
  const bg = loaded.get('/house/yard_bg2.webp')
  if (bg) {
    const s = Math.max(STAGE_W / bg.width, STAGE_H / bg.height)
    const w = bg.width * s, h = bg.height * s
    ctx.drawImage(bg, (STAGE_W - w) / 2, (STAGE_H - h) / 2, w, h)
  } else {
    ctx.fillStyle = '#3f6b34'
    ctx.fillRect(0, 0, STAGE_W, STAGE_H)
  }

  // ── depth-sorted draw list: fence links + every sprite ──
  type Item = { depth: number; draw: () => void }
  const items: Item[] = []
  const at = (src: string, x: number, y: number, w: number, mirror = false, charred = false) => {
    const im = loaded.get(src)
    if (!im) return
    const h = w * (im.height / im.width)
    const dx = x - w / 2, dy = y + TILE_H * 0.28 - h
    ctx.save()
    try { if (charred) ctx.filter = 'grayscale(0.85) brightness(0.5) sepia(0.4)' } catch {}
    if (mirror) { ctx.translate(x * 2, 0); ctx.scale(-1, 1) }
    ctx.drawImage(im, dx, dy, w, h)
    ctx.restore()
  }

  const activeFences = new Set(inp.buildings.filter(b => b.type === 'fence' && !b.damaged).map(b => b.pad))
  const { links, linked } = fenceAdjacency(activeFences)
  for (const l of links) {
    items.push({
      depth: l.depth * 10 + 2,
      draw: () => {
        if (l.shear !== 0) {
          const im = loaded.get('/house/wall_se2.webp')
          if (!im) return
          ctx.save()
          if (l.shear === -1) {
            // SW piece = SE art mirrored in place (CSS scaleX(-1) on the img box)
            ctx.translate((l.x + WALL.swLeft) * 2 + WALL.w, 0)
            ctx.scale(-1, 1)
            ctx.drawImage(im, l.x + WALL.swLeft, l.y + WALL.top, WALL.w, WALL.h)
          } else {
            ctx.drawImage(im, l.x + WALL.seLeft, l.y + WALL.top, WALL.w, WALL.h)
          }
          ctx.restore()
        } else {
          const im = loaded.get('/house/fence2.webp')
          if (im) ctx.drawImage(im, l.x - l.w / 2, l.y + TILE_H * 0.28 - LINK_H, l.w, LINK_H)
        }
      },
    })
  }

  const pushSprite = (pad: number, src: string, w: number, mirror = false, charred = false) => {
    const p = isoPos(pad)
    items.push({ depth: p.depth * 10, draw: () => at(src, p.x, p.y, w, mirror, charred) })
  }
  pushSprite(HQ_PAD, hqImage(inp.hqLevel), 198)
  pushSprite(inp.printShopPad, '/house/print_shop.webp', 128)
  for (const b of inp.buildings) {
    const a = ART[b.type]
    if (!a) continue
    if (b.type === 'fence') {
      if (b.damaged) continue // a downed fence just isn't in the ring
      const isLinked = linked.has(b.pad)
      pushSprite(b.pad, isLinked ? '/house/fence_post2.webp' : '/house/fence2.webp', isLinked ? 13 : 76)
      continue
    }
    pushSprite(b.pad, a.img(b.level), a.w, ((b.facing ?? 0) % 2) === 1, b.damaged)
  }
  items.sort((a, b) => a.depth - b.depth)
  for (const it of items) it.draw()

  // ── vignette (the stage's own look) ──
  const vg = ctx.createRadialGradient(STAGE_W / 2, STAGE_H / 2, STAGE_H * 0.45, STAGE_W / 2, STAGE_H / 2, STAGE_H * 0.95)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.34)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, STAGE_W, STAGE_H)

  // ── banner: dark glass plate, party accent, the brag line ──
  const bx = 46, bh = 150, by = STAGE_H - bh - 42, bw = 950
  ctx.save()
  ctx.beginPath()
  const r = 26
  ctx.moveTo(bx + r, by)
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
  ctx.arcTo(bx, by + bh, bx, by, r)
  ctx.arcTo(bx, by, bx + bw, by, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(8,13,10,0.82)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(251,191,36,0.35)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = inp.tint
  ctx.fillRect(bx, by + 14, 9, bh - 28)
  ctx.fillStyle = '#fbbf24'
  ctx.font = '900 46px Arial, sans-serif'
  ctx.fillText('PoliticsGo', bx + 38, by + 60)
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 40px Arial, sans-serif'
  ctx.fillText(`${inp.name}'s base`, bx + 38, by + 116)
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '700 32px Arial, sans-serif'
  ctx.fillText(`🏠 HQ Lv ${inp.hqLevel}   🛡️ ${inp.defScore}   🏆 ${inp.trophies}`, bx + 470, by + 116)
  ctx.restore()

  return await new Promise<Blob>((resolve, reject) => {
    cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
