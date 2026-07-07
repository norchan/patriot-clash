// Metro-aware town hall list:
//  - cluster cities: a city joins the cluster of the nearest LARGER city's
//    anchor within 25 miles (processed in descending population order)
//  - clusters with total pop >= 350k are "major metros" -> top 10 cities each
//  - everything else: top 20 cities per state
//  - St. Peter MN force-included
const fs = require('fs')

const STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WY','DC'])
const OK_CODES = new Set(['PPL','PPLA','PPLA2','PPLA3','PPLA4','PPLA5','PPLC','PPLG','PPLL','PPLS'])
const METRO_JOIN_MILES = 25
const METRO_MIN_POP = 350000
const PER_METRO = 10
const PER_STATE_OUTSTATE = 20

const counties = {}
for (const line of fs.readFileSync('admin2Codes.txt', 'utf8').split('\n')) {
  const [code, name] = line.split('\t')
  if (code && code.startsWith('US.') && name) {
    counties[code] = name.replace(/ County$| Parish$| Borough$| Census Area$| Municipality$/, '')
  }
}

const normalizeName = n => n.replace(/^Saint /, 'St. ')

function miles(a, b) {
  const R = 3958.8
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const byState = {}
for (const line of fs.readFileSync('cities5000.txt', 'utf8').split('\n')) {
  const f = line.split('\t')
  if (f.length < 15 || f[8] !== 'US') continue
  const state = f[10], code = f[7]
  if (!STATES.has(state) || !OK_CODES.has(code)) continue
  const name = normalizeName(f[2])
  if (name === 'New York City') continue
  const pop = parseInt(f[14]) || 0
  if (pop < 1000) continue
  const county = counties[`US.${state}.${f[11]}`] || ''
  ;(byState[state] ||= []).push({ name, county, state, pop, lat: parseFloat(f[4]), lng: parseFloat(f[5]) })
}

const out = []
const seen = new Set()

for (const state of [...STATES].sort()) {
  let list = (byState[state] || []).sort((a, b) => b.pop - a.pop)
  // dedupe same names within state (geonames city+CDP double entries)
  const dn = new Set()
  list = list.filter(c => { const k = c.name.toLowerCase(); if (dn.has(k)) return false; dn.add(k); return true })

  if (state === 'DC') {
    const w = list.find(c => c.name === 'Washington')
    if (w) { out.push(w); seen.add(`washington|DC`) }
    continue
  }

  // Greedy clustering, descending population: join nearest anchor within range
  const clusters = []
  for (const c of list) {
    let best = null, bestD = Infinity
    for (const cl of clusters) {
      const d = miles(c, cl.anchor)
      if (d < METRO_JOIN_MILES && d < bestD) { best = cl; bestD = d }
    }
    if (best) { best.members.push(c); best.pop += c.pop }
    else clusters.push({ anchor: c, members: [c], pop: c.pop })
  }

  const picked = []
  const inMetro = new Set()
  for (const cl of clusters) {
    if (cl.pop >= METRO_MIN_POP) {
      // major metro: top 10 only
      cl.members.slice(0, PER_METRO).forEach(c => picked.push(c))
      cl.members.forEach(c => inMetro.add(c))
    }
  }
  // top 20 statewide outside major metros
  const outstate = list.filter(c => !inMetro.has(c)).slice(0, PER_STATE_OUTSTATE)
  picked.push(...outstate)

  for (const c of picked) {
    const k = `${c.name.toLowerCase()}|${c.state}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
}

// Force-include St. Peter, MN
if (!seen.has('st. peter|MN')) {
  const sp = (byState['MN'] || []).find(c => c.name === 'St. Peter')
  out.push(sp || { name: 'St. Peter', county: 'Nicollet', state: 'MN', pop: 12066, lat: 44.3236, lng: -93.9594 })
  seen.add('st. peter|MN')
}

fs.writeFileSync('c:/Users/Micha/patriot-clash/scripts/townhalls_v2.json', JSON.stringify(out, null, 1))
console.log(`total: ${out.length}`)
const mn = out.filter(c => c.state === 'MN').map(c => c.name)
console.log(`MN (${mn.length}):`, mn.join(', '))
const ca = out.filter(c => c.state === 'CA')
console.log(`CA count: ${ca.length}`)
