// Measures Slots Salute return-to-player by Monte Carlo, including the
// free-spins bonus, and prints the RTP_SCALAR that lands RTP at the target.
// Replicates config/slots.ts math (keep the numbers in sync).
const REELS = 5, ROWS = 3, WILD = 0, SCATTER = 1
const FREE_SPINS_AWARD = 8, FS_MULTIPLIER = 2, FS_RETRIGGER = 5, FS_MAX = 30
const W = [3, 4, 6, 8, 11, 14, 18, 22]
const WT = W.reduce((a, b) => a + b, 0)
const PAYS = { 2: [0.5, 2.0, 8.0], 3: [0.3, 1.2, 5.0], 4: [0.2, 0.8, 3.0], 5: [0.12, 0.5, 2.0], 6: [0.08, 0.3, 1.0], 7: [0.05, 0.2, 0.6] }
const SCATTER_PAY = { 3: 1, 4: 5, 5: 25 }
const TARGET = 0.88

const pick = () => { let r = Math.random() * WT; for (let i = 0; i < W.length; i++) { r -= W[i]; if (r < 0) return i } return 7 }
const grid = () => Array.from({ length: REELS }, () => Array.from({ length: ROWS }, pick))

function evalGrid(g, bet, mult) {
  let win = 0, scatters = 0
  for (let s = 2; s <= 7; s++) {
    let ways = 1, L = 0
    for (let r = 0; r < REELS; r++) {
      let c = 0
      for (let row = 0; row < ROWS; row++) if (g[r][row] === s || g[r][row] === WILD) c++
      if (c === 0) break
      ways *= c; L++
    }
    if (L >= 3) win += bet * PAYS[s][L - 3] * ways * mult
  }
  for (let r = 0; r < REELS; r++) for (let row = 0; row < ROWS; row++) if (g[r][row] === SCATTER) scatters++
  let free = 0
  if (scatters >= 3) { win += bet * (SCATTER_PAY[Math.min(scatters, 5)] ?? 0) * mult; free = FREE_SPINS_AWARD }
  return { win, free }
}

const N = 3_000_000
const bet = 100
let totalWin = 0, totalBet = 0, bonusRounds = 0, biggest = 0
for (let i = 0; i < N; i++) {
  totalBet += bet
  const base = evalGrid(grid(), bet, 1)
  let roundWin = base.win
  if (base.free > 0) {
    bonusRounds++
    let remaining = base.free, awarded = base.free
    while (remaining > 0) {
      const fs = evalGrid(grid(), bet, FS_MULTIPLIER)
      roundWin += fs.win
      if (fs.free > 0 && awarded < FS_MAX) { const add = Math.min(FS_RETRIGGER, FS_MAX - awarded); remaining += add; awarded += add }
      remaining--
    }
  }
  totalWin += roundWin
  if (roundWin > biggest) biggest = roundWin
}
const rtpAt1 = totalWin / totalBet
console.log(`spins: ${N.toLocaleString()}`)
console.log(`RTP at scalar=1: ${(rtpAt1 * 100).toFixed(1)}%`)
console.log(`bonus trigger rate: 1 in ${Math.round(N / bonusRounds)}`)
console.log(`biggest round: ${(biggest).toLocaleString()} (${(biggest / bet).toFixed(0)}x bet) at scalar=1`)
console.log(`\n=> set RTP_SCALAR = ${(TARGET / rtpAt1).toFixed(4)}  (for ${(TARGET * 100).toFixed(0)}% RTP)`)
