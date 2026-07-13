// Deterministic garrison position for a bot inside its home town hall's circle.
// Used by BOTH the map's nearby endpoint (to place the marker) and the profile
// endpoint (so "View on map" flies to the exact same spot). Seeded only by the
// bot + hall, so it's stable and identical on both sides.

function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return Math.abs(h) / 2147483647
}

export function garrisonPosition(
  botId: string,
  hallId: string,
  hallLat: number,
  hallLng: number,
): { lat: number; lng: number } {
  // Two independent hashes → a scattered point; sqrt on the radius spreads
  // bots evenly across the disc instead of bunching them on a ring.
  const angle = seededRand(`${botId}|${hallId}|ang`) * Math.PI * 2
  const distMiles = 0.25 + Math.sqrt(seededRand(`${botId}|${hallId}|rad`)) * 4.2
  return {
    lat: hallLat + (distMiles / 69) * Math.sin(angle),
    lng: hallLng + (distMiles / (69 * Math.cos(hallLat * Math.PI / 180))) * Math.cos(angle),
  }
}
