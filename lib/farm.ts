// Campaign HQ farms (siege rework Phase B4). One producer for now: the
// PRINT SHOP — slowly prints firecracker-tier siege ammo. Production math
// lives here as pure functions so the economy tests can pin it; the atomic
// claim itself is the claim_print_shop SQL function (same constants).

export const PRINT_SHOP_RATE_MS = 2 * 3600 * 1000 // one firecracker every 2h
export const PRINT_SHOP_CAP = 10                  // max banked between claims

/** How many firecrackers are ready given time since the last claim. */
export function printShopReady(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  return Math.min(PRINT_SHOP_CAP, Math.floor(elapsedMs / PRINT_SHOP_RATE_MS))
}

/** ms until the NEXT unit is ready (0 when one is already waiting). */
export function printShopNextInMs(elapsedMs: number): number {
  if (printShopReady(elapsedMs) >= PRINT_SHOP_CAP) return 0
  if (elapsedMs <= 0) return PRINT_SHOP_RATE_MS
  const intoCycle = elapsedMs % PRINT_SHOP_RATE_MS
  return printShopReady(elapsedMs) > 0 && intoCycle === 0 ? 0 : PRINT_SHOP_RATE_MS - intoCycle
}
