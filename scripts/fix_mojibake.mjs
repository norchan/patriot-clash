// Repairs double-encoded UTF-8 ("mojibake") in source files.
//
// Cause: a tool wrote the file using the system ANSI codepage (cp1252) instead
// of UTF-8, so every multi-byte character was re-encoded byte-by-byte —
// ❌ became âŒ, ⚔️ became âš”ï¸. On the siege screen that surfaced as garbled
// glyphs in every attack toast (Michael, 2026-07-28: "some of it is in the
// wrong language").
//
// A blanket cp1252 round-trip would be WRONG here: later edits wrote correct
// UTF-8 into the same file, so genuine characters (—, ', ") sit alongside the
// corrupted runs. Instead this walks each maximal run of non-ASCII characters
// and only rewrites a run when it re-encodes to *strictly valid* UTF-8. A lone
// genuine — encodes to the single byte 0x97, which is not valid standalone
// UTF-8, so it is left untouched. That check is the whole safety argument.
//
// Usage: node scripts/fix_mojibake.mjs <file>...   (--check to only report)

import fs from 'fs'

// cp1252's 0x80–0x9F block; every other byte 0xA0–0xFF maps to U+00A0–U+00FF.
const CP1252_HIGH = {
  0x20AC: 0x80, 0x0081: 0x81, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89,
  0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x008D: 0x8D, 0x017D: 0x8E,
  0x008F: 0x8F, 0x0090: 0x90, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x009D: 0x9D,
  0x017E: 0x9E, 0x0178: 0x9F,
}

/** Encode one char back to its cp1252 byte, or null if it has no mapping. */
function toByte(ch) {
  const cp = ch.codePointAt(0)
  if (cp < 0x100 && !(cp >= 0x80 && cp <= 0x9f)) return cp
  return CP1252_HIGH[cp] ?? null
}

const strict = new TextDecoder('utf-8', { fatal: true })

function repair(text) {
  let out = '', i = 0, fixes = 0
  while (i < text.length) {
    if (text.charCodeAt(i) < 0x80) { out += text[i++]; continue }
    let j = i
    while (j < text.length && text.charCodeAt(j) >= 0x80) j++
    const run = text.slice(i, j)
    const bytes = []
    let encodable = true
    for (const ch of run) {
      const b = toByte(ch)
      if (b === null) { encodable = false; break }
      bytes.push(b)
    }
    let decoded = null
    if (encodable) {
      try { decoded = strict.decode(new Uint8Array(bytes)) } catch { decoded = null }
    }
    // Only accept a decode that actually changed something and did not just
    // pass ASCII straight through (a run is non-ASCII by construction).
    if (decoded && decoded !== run) { out += decoded; fixes++ } else { out += run }
    i = j
  }
  return { out, fixes }
}

const check = process.argv.includes('--check')
const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
let total = 0

for (const f of files) {
  let text = fs.readFileSync(f, 'utf8')
  const hadBom = text.charCodeAt(0) === 0xfeff
  if (hadBom) text = text.slice(1)
  const { out, fixes } = repair(text)
  if (!fixes && !hadBom) { console.log(`  ${f}: clean`); continue }
  total += fixes
  console.log(`${check ? '·' : '✔'} ${f}: ${fixes} run(s)${hadBom ? ' + BOM' : ''}`)
  if (!check) fs.writeFileSync(f, out, { encoding: 'utf8' }) // node writes BOM-less UTF-8
}
console.log(`\n${total} run(s) ${check ? 'would be' : ''} repaired across ${files.length} file(s)`)
